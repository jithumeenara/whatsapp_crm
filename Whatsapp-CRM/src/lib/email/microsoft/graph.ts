/**
 * "Connect with Microsoft" — a Microsoft 365 / Outlook mailbox as the
 * email channel, through the Microsoft identity platform (OAuth 2.0
 * authorization code flow with PKCE) and Microsoft Graph.
 *
 * Every address this file calls is fixed below; nothing from a request
 * or from the database is ever used as a host. The tenant and client
 * ids that go into a URL are checked to be GUIDs first.
 *
 * What the mailbox is allowed (granted by the tenant's admin on the app
 * registration, delegated, so only ever this one signed-in mailbox):
 * Mail.ReadWrite, Mail.Send, offline_access, User.Read.
 *
 * Sources: learn.microsoft.com — "Microsoft identity platform and OAuth
 * 2.0 authorization code flow", Microsoft Graph "Create subscription",
 * "subscription resource type" (Outlook messages: at most 10,080
 * minutes), "user: sendMail".
 */

import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { ensureMicrosoftMailboxTable } from './store'

const LOGIN = 'https://login.microsoftonline.com'
const GRAPH = 'https://graph.microsoft.com/v1.0'

export const MS_SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send'
export const CALLBACK_PATH = '/api/email/microsoft/callback'
export const NOTIFY_PATH = '/api/email/microsoft/notify'
/** Short-lived, encrypted cookie holding the sign-in in progress. */
export const OAUTH_COOKIE = 'ms_mail_oauth'

/** A little under Graph's 10,080-minute ceiling for Outlook messages. */
const SUBSCRIPTION_MINUTES = 10_000

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isGuid = (v: unknown): v is string => typeof v === 'string' && GUID.test(v.trim())

// ── PKCE ────────────────────────────────────────────────────────────────

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function authorizeUrl(args: {
  tenantId: string
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  if (!isGuid(args.tenantId) || !isGuid(args.clientId)) throw new Error('Invalid tenant or client id')
  const q = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    // Always ask which account: the admin who set this up is usually
    // signed in, and it is a different mailbox that should be connected.
    prompt: 'select_account',
  })
  return `${LOGIN}/${args.tenantId}/oauth2/v2.0/authorize?${q}`
}

// ── Tokens ──────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

async function tokenRequest(tenantId: string, body: Record<string, string>): Promise<TokenResponse> {
  if (!isGuid(tenantId)) throw new Error('Invalid tenant id')
  const res = await fetch(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    // The description names the problem (wrong secret, expired secret,
    // redirect mismatch) without echoing anything sensitive back.
    throw new Error(data.error_description?.split('\r\n')[0] || data.error || `Token request failed (HTTP ${res.status})`)
  }
  return data
}

export async function exchangeCode(args: {
  tenantId: string
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  verifier: string
}): Promise<TokenResponse> {
  return tokenRequest(args.tenantId, {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    scope: MS_SCOPES,
  })
}

type MailboxRow = NonNullable<Awaited<ReturnType<typeof prisma.microsoftMailbox.findUnique>>>

/** A usable access token for this mailbox, refreshed when it is within
 *  five minutes of expiring. Microsoft may hand back a new refresh token
 *  each time; the newest is always the one kept. */
export async function accessTokenFor(box: MailboxRow): Promise<string> {
  if (box.access_token && box.access_expires_at && box.access_expires_at.getTime() - Date.now() > 5 * 60_000) {
    return decrypt(box.access_token)
  }
  if (!box.refresh_token) throw new Error('Mailbox is not connected')
  let tokens: TokenResponse
  try {
    tokens = await tokenRequest(box.tenant_id, {
      client_id: box.client_id,
      client_secret: decrypt(box.client_secret),
      grant_type: 'refresh_token',
      refresh_token: decrypt(box.refresh_token),
      scope: MS_SCOPES,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.microsoftMailbox
      .update({ where: { id: box.id }, data: { status: 'error', last_error: `Sign-in expired: ${message}`.slice(0, 500) } })
      .catch(() => {})
    throw err
  }
  const updated = await prisma.microsoftMailbox.update({
    where: { id: box.id },
    data: {
      access_token: encrypt(tokens.access_token),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
      ...(tokens.refresh_token ? { refresh_token: encrypt(tokens.refresh_token) } : {}),
    },
  })
  Object.assign(box, updated)
  return tokens.access_token
}

// ── Graph calls ─────────────────────────────────────────────────────────

async function graph<T>(token: string, path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const { prefer, ...rest } = init
  const res = await fetch(`${GRAPH}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(rest.headers ?? {}),
    },
  })
  if (res.status === 202 || res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } }
  if (!res.ok) {
    const e = new Error(data.error?.message || `Microsoft Graph request failed (HTTP ${res.status})`) as Error & { status?: number }
    e.status = res.status
    throw e
  }
  return data
}

export async function whoAmI(token: string): Promise<{ email: string; name: string | null }> {
  const me = await graph<{ mail?: string | null; userPrincipalName?: string; displayName?: string | null }>(
    token,
    '/me?$select=mail,userPrincipalName,displayName',
  )
  return { email: (me.mail || me.userPrincipalName || '').toLowerCase(), name: me.displayName ?? null }
}

export async function createInboxSubscription(token: string, notificationUrl: string, clientState: string) {
  return graph<{ id: string; expirationDateTime: string }>(token, '/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      // Same endpoint: it also answers "renew me" and "I was removed".
      lifecycleNotificationUrl: notificationUrl,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString(),
      clientState,
    }),
  })
}

export async function renewSubscription(token: string, subscriptionId: string) {
  return graph<{ id: string; expirationDateTime: string }>(token, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString() }),
  })
}

export async function deleteSubscription(token: string, subscriptionId: string) {
  await graph(token, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' }).catch(() => {})
}

export interface GraphMessage {
  id: string
  subject?: string | null
  internetMessageId?: string | null
  from?: { emailAddress?: { address?: string; name?: string } } | null
  body?: { contentType?: string; content?: string } | null
  bodyPreview?: string | null
  toRecipients?: Array<{ emailAddress?: { address?: string } }> | null
  ccRecipients?: Array<{ emailAddress?: { address?: string } }> | null
  hasAttachments?: boolean | null
}

export async function getMessage(token: string, messageId: string): Promise<GraphMessage> {
  return graph<GraphMessage>(
    token,
    `/me/messages/${encodeURIComponent(messageId)}?$select=subject,from,body,bodyPreview,internetMessageId,toRecipients,ccRecipients,hasAttachments`,
    // Plain text, so no HTML from an email ever reaches the Inbox.
    { prefer: 'outlook.body-content-type="text"' },
  )
}

/** The mailbox's own id for an email, from its Internet Message-ID (what
 *  the Inbox stores). Null when it is not in this mailbox any more. */
export async function findByInternetMessageId(token: string, internetMessageId: string): Promise<string | null> {
  const filter = `internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`
  const data = await graph<{ value?: Array<{ id: string }> }>(
    token,
    `/me/messages?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`,
  )
  return data?.value?.[0]?.id ?? null
}

// ── Sending with formatting, copies and files ───────────────────────────

export interface OutgoingAttachment {
  name: string
  mime: string
  bytes: Buffer
}

/** Each file goes in its own request, and Graph takes a file in one
 *  request only under 3 MB ("Attach large files to Outlook messages"). */
export const GRAPH_ATTACHMENT_MAX = 3 * 1024 * 1024 - 1

export interface GraphSend {
  kind: 'new' | 'reply' | 'reply_all' | 'forward'
  /** The mailbox's id of the email answered or forwarded. */
  sourceId?: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  html: string
  attachments: OutgoingAttachment[]
}

const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }))

/** Our part goes at the top of the draft Graph builds for a reply or
 *  forward, above the quoted original it already contains. */
function prependToBody(existing: string, ours: string): string {
  const open = existing.match(/<body[^>]*>/i)
  if (!open || open.index === undefined) return `${ours}${existing}`
  const at = open.index + open[0].length
  return `${existing.slice(0, at)}${ours}${existing.slice(at)}`
}

/**
 * One way to send every kind of email: make a draft (new, or Graph's
 * own reply / reply-all / forward of the original, which carries the
 * thread headers and the quoted text), put our body, copies and files on
 * it, then send it. Graph saves it to Sent Items. A draft left behind by
 * a failed send is deleted, so the mailbox's Drafts do not fill up.
 */
export async function sendGraphEmail(token: string, s: GraphSend): Promise<void> {
  let draftId: string
  if (s.kind === 'new' || !s.sourceId) {
    const draft = await graph<{ id: string }>(token, '/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        subject: s.subject,
        body: { contentType: 'HTML', content: s.html },
        toRecipients: recipients(s.to),
        ccRecipients: recipients(s.cc),
        bccRecipients: recipients(s.bcc),
      }),
    })
    draftId = draft.id
  } else {
    const action = s.kind === 'reply' ? 'createReply' : s.kind === 'reply_all' ? 'createReplyAll' : 'createForward'
    const draft = await graph<{ id: string; body?: { content?: string } }>(
      token,
      `/me/messages/${encodeURIComponent(s.sourceId)}/${action}`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    draftId = draft.id
    const patch: Record<string, unknown> = {
      body: { contentType: 'HTML', content: prependToBody(draft.body?.content ?? '', s.html) },
    }
    // Reply all keeps everyone Graph copied unless the agent chose copies.
    if (s.cc.length) patch.ccRecipients = recipients(s.cc)
    if (s.bcc.length) patch.bccRecipients = recipients(s.bcc)
    if (s.kind === 'forward') patch.toRecipients = recipients(s.to)
    await graph(token, `/me/messages/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
  }

  try {
    for (const a of s.attachments) {
      if (a.bytes.length > GRAPH_ATTACHMENT_MAX) throw new Error(`${a.name} is over 3 MB`)
      await graph(token, `/me/messages/${encodeURIComponent(draftId)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentType: a.mime,
          contentBytes: a.bytes.toString('base64'),
        }),
      })
    }
    await graph(token, `/me/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' })
  } catch (err) {
    await graph(token, `/me/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => {})
    throw err
  }
}

export interface IncomingAttachment {
  name: string
  mime: string
  bytes: Buffer
}

/** The files a customer attached, skipping inline pictures (signatures,
 *  logos), anything over `maxEach`, and anything past `maxCount`. */
export async function fetchFileAttachments(
  token: string,
  messageId: string,
  opts: { maxEach: number; maxCount: number },
): Promise<{ files: IncomingAttachment[]; skipped: string[] }> {
  const list = await graph<{
    value?: Array<{ id: string; name?: string; contentType?: string; size?: number; isInline?: boolean; '@odata.type'?: string }>
  }>(token, `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`)
  const files: IncomingAttachment[] = []
  const skipped: string[] = []
  for (const a of list?.value ?? []) {
    if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue
    const name = (a.name || 'attachment').slice(0, 200)
    if (files.length >= opts.maxCount || !a.size || a.size > opts.maxEach) {
      skipped.push(name)
      continue
    }
    const full = await graph<{ contentBytes?: string }>(
      token,
      `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`,
    )
    if (!full?.contentBytes) {
      skipped.push(name)
      continue
    }
    files.push({
      name,
      mime: (a.contentType || 'application/octet-stream').toLowerCase().split(';')[0].trim(),
      bytes: Buffer.from(full.contentBytes, 'base64'),
    })
  }
  return { files, skipped }
}

// ── The account's mailbox ───────────────────────────────────────────────

export async function loadMailbox(accountId: string) {
  await ensureMicrosoftMailboxTable()
  return prisma.microsoftMailbox.findUnique({ where: { account_id: accountId } })
}

/** The connected mailbox, if this account has one that works. */
export async function connectedMailbox(accountId: string) {
  const box = await loadMailbox(accountId).catch(() => null)
  return box && box.refresh_token && box.status !== 'not_connected' ? box : null
}

/** Keeps the new-mail subscription alive: renewed a day before it lapses,
 *  recreated if Graph no longer knows it. Run on a timer. */
export async function sweepMicrosoftSubscriptions(): Promise<void> {
  await ensureMicrosoftMailboxTable()
  const soon = new Date(Date.now() + 24 * 60 * 60_000)
  const boxes = await prisma.microsoftMailbox.findMany({
    where: {
      refresh_token: { not: null },
      notification_url: { not: null },
      OR: [{ subscription_expires_at: null }, { subscription_expires_at: { lt: soon } }],
    },
  })
  for (const box of boxes) {
    try {
      const token = await accessTokenFor(box)
      let sub: { id: string; expirationDateTime: string } | null = null
      if (box.subscription_id) {
        sub = await renewSubscription(token, box.subscription_id).catch((err: Error & { status?: number }) => {
          if (err.status === 404) return null
          throw err
        })
      }
      if (!sub) sub = await createInboxSubscription(token, box.notification_url!, box.client_state)
      await prisma.microsoftMailbox.update({
        where: { id: box.id },
        data: {
          subscription_id: sub.id,
          subscription_expires_at: new Date(sub.expirationDateTime),
          status: 'connected',
          last_error: null,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[microsoft-mail] subscription upkeep failed:', message)
      await prisma.microsoftMailbox
        .update({ where: { id: box.id }, data: { status: 'error', last_error: message.slice(0, 500) } })
        .catch(() => {})
    }
  }
}
