/**
 * Gmail, for the two Gmail cards in Settings → Google.
 *
 *   gmail_send  (gmail.send, sensitive)   — Inbox replies go out from the
 *               Gmail address and land in its Sent folder. Cannot read.
 *   gmail_inbox (gmail.modify, restricted) — also brings new mail in: every
 *               minute the CRM asks Gmail what changed since the last
 *               read (history.list), and each new message goes through the
 *               same intake as any other email (email/ingest.ts).
 *
 * No Pub/Sub: it would need a topic, a subscription and a publisher
 * grant in Google Cloud, and a watch renewed every week. A minute's
 * polling of one counter is cheap and has no setup.
 */

import { prisma } from '@/lib/db'
import { googleAccessToken, isGoogleServiceEnabled, logGoogleActivity } from './oauth'
import { ensureGoogleTables } from './store'
import { disabledApi, disabledApiMessage, isApiDisabled } from './api-disabled'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MAX_PER_POLL = 200
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS = 10

export class GmailError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GmailError'
  }
}

async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new GmailError(`Could not reach Gmail: ${err instanceof Error ? err.message : String(err)}`, 0)
  }
  if (res.ok) return (await res.json().catch(() => ({}))) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Gmail returned ${res.status}`
  if (isApiDisabled(msg)) {
    throw new GmailError(disabledApiMessage(disabledApi(msg, 'Gmail API')), res.status)
  }
  throw new GmailError(msg, res.status)
}

// ── Sending ──────────────────────────────────────────────────────────────

/** RFC 2047 for a header with anything beyond plain ASCII — a Malayalam
 *  subject would otherwise arrive as question marks. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, (m) => `${m}\r\n`).trimEnd()
}

/** A header address list, with anything that could break the header removed. */
function addressList(list: readonly string[]): string {
  return list.map((a) => a.replace(/[\r\n<>,"]/g, '').trim()).filter(Boolean).join(', ')
}

export interface MimeInput {
  from: string
  to: readonly string[]
  cc?: readonly string[]
  bcc?: readonly string[]
  subject: string
  text: string
  html: string
  inReplyTo?: string | null
  attachments?: ReadonlyArray<{ name: string; mime: string; bytes: Buffer }>
}

/** The raw RFC 5322 message Gmail's send takes. */
export function buildMime(m: MimeInput, boundarySeed = `${Date.now()}${Math.random().toString(36).slice(2)}`): string {
  const mixed = `mixed_${boundarySeed}`
  const alt = `alt_${boundarySeed}`
  const lines: string[] = [
    `From: ${addressList([m.from])}`,
    `To: ${addressList(m.to)}`,
    ...(m.cc?.length ? [`Cc: ${addressList(m.cc)}`] : []),
    ...(m.bcc?.length ? [`Bcc: ${addressList(m.bcc)}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
  ]
  // A reply keeps the customer's thread in their mail app and in Gmail.
  const ref = m.inReplyTo && /^<.+>$/.test(m.inReplyTo.trim()) ? m.inReplyTo.trim() : m.inReplyTo ? `<${m.inReplyTo.trim().replace(/[<>\r\n]/g, '')}>` : null
  if (ref) lines.push(`In-Reply-To: ${ref}`, `References: ${ref}`)

  const altPart = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(m.text, 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(m.html, 'utf8').toString('base64')),
    `--${alt}--`,
  ]

  if (!m.attachments?.length) {
    lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`, '', ...altPart)
  } else {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...altPart)
    for (const a of m.attachments) {
      const name = encodeHeader(a.name.replace(/["\r\n]/g, ''))
      lines.push(
        `--${mixed}`,
        `Content-Type: ${a.mime.replace(/[\r\n;]/g, '')}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(a.bytes.toString('base64')),
      )
    }
    lines.push(`--${mixed}--`)
  }
  return lines.join('\r\n')
}

/** The thread a message belongs to, found by its Message-ID — so a reply
 *  sits in the same Gmail thread. Needs read access; null without it. */
async function threadOf(token: string, rfcMessageId: string): Promise<string | null> {
  const id = rfcMessageId.replace(/[<>]/g, '').trim()
  if (!id) return null
  const res = await gmail<{ messages?: Array<{ threadId?: string }> }>(
    token,
    `/messages?maxResults=1&includeSpamTrash=false&q=${encodeURIComponent(`rfc822msgid:${id}`)}`,
  ).catch(() => null)
  return res?.messages?.[0]?.threadId ?? null
}

/** Which Gmail service can send for this account, if any. */
export async function gmailSender(accountId: string): Promise<{ email: string; canRead: boolean } | null> {
  const [inbox, send] = await Promise.all([
    isGoogleServiceEnabled(accountId, 'gmail_inbox'),
    isGoogleServiceEnabled(accountId, 'gmail_send'),
  ])
  if (!inbox && !send) return null
  const conn = await prisma.googleConnection.findUnique({ where: { account_id: accountId }, select: { google_email: true } })
  if (!conn?.google_email) return null
  return { email: conn.google_email, canRead: inbox }
}

export async function sendViaGmail(
  accountId: string,
  m: Omit<MimeInput, 'from'>,
): Promise<{ messageId: string }> {
  const sender = await gmailSender(accountId)
  if (!sender) throw new GmailError('Gmail is not connected.', 400)
  const token = await googleAccessToken(accountId)
  const raw = Buffer.from(buildMime({ ...m, from: sender.email }), 'utf8').toString('base64url')
  const threadId = sender.canRead && m.inReplyTo ? await threadOf(token, m.inReplyTo) : null
  const sent = await gmail<{ id?: string; threadId?: string }>(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  })
  // The RFC Message-ID, when the mailbox can be read, so a customer's
  // answer to this email is recognised as a reply to it.
  if (sender.canRead && sent.id) {
    const meta = await gmail<{ payload?: { headers?: Array<{ name: string; value: string }> } }>(
      token,
      `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
    ).catch(() => null)
    const header = meta?.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value
    if (header) return { messageId: header }
  }
  return { messageId: sent.id ? `gmail:${sent.id}` : '' }
}

// ── Reading ──────────────────────────────────────────────────────────────

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  payload?: GmailPart
  snippet?: string
}

export function header(part: GmailPart | undefined, name: string): string {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** "Name <a@b.com>, c@d.com" → ["a@b.com", "c@d.com"], lowercased. */
export function addressesIn(value: string): string[] {
  const out: string[] = []
  for (const m of value.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.push(m[0].toLowerCase())
  return [...new Set(out)].slice(0, 20)
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : ''
}

/** The readable body and the attachments' handles, from Gmail's parsed tree. */
export function readParts(root: GmailPart | undefined): {
  text: string
  html: string
  files: Array<{ name: string; mime: string; attachmentId: string; size: number }>
} {
  let text = ''
  let html = ''
  const files: Array<{ name: string; mime: string; attachmentId: string; size: number }> = []
  const walk = (p: GmailPart | undefined) => {
    if (!p) return
    const isAttachment = Boolean(p.filename) && Boolean(p.body?.attachmentId)
    if (isAttachment) {
      files.push({ name: p.filename!, mime: p.mimeType ?? 'application/octet-stream', attachmentId: p.body!.attachmentId!, size: p.body?.size ?? 0 })
    } else if (p.mimeType === 'text/plain' && !text) {
      text = decode(p.body?.data)
    } else if (p.mimeType === 'text/html' && !html) {
      html = decode(p.body?.data)
    }
    for (const c of p.parts ?? []) walk(c)
  }
  walk(root)
  return { text, html, files }
}

async function htmlToPlain(html: string): Promise<string> {
  const { htmlToText } = await import('@/lib/ai/web-extract')
  return htmlToText(html)
}

/** One new message into the Inbox. Returns whether it was taken in. */
async function ingestMessage(accountId: string, ownerUserId: string, ownEmail: string, token: string, id: string): Promise<boolean> {
  // Already here (a re-read after an error, or the same mail twice):
  // checked on the headers alone, before any body or file is downloaded.
  const head = await gmail<GmailMessage>(token, `/messages/${id}?format=metadata&metadataHeaders=Message-ID`)
  const rfcId = header(head.payload, 'Message-ID') || `gmail:${id}`
  const seen = await prisma.message.findFirst({
    where: { message_id: { in: [rfcId, `gmail:${id}`] }, conversation: { account_id: accountId } },
    select: { id: true },
  })
  if (seen) return false
  const msg = await gmail<GmailMessage>(token, `/messages/${id}?format=full`)
  const labels = msg.labelIds ?? []
  // Only mail that came in: not what this mailbox sent, drafted, or
  // Gmail put in spam.
  if (!labels.includes('INBOX') || labels.some((l) => l === 'SENT' || l === 'DRAFT' || l === 'SPAM' || l === 'TRASH')) return false
  const from = addressesIn(header(msg.payload, 'From'))[0]
  if (!from || from === ownEmail) return false

  const { text, html, files } = readParts(msg.payload)
  const body = (text || (html ? await htmlToPlain(html) : '') || msg.snippet || '').trim().slice(0, 20_000)

  const { contentMatchesType, isAllowedMime, saveAccountFile } = await import('@/lib/files/account-files')
  const attachments: Array<Record<string, unknown>> = []
  const skipped: string[] = []
  for (const f of files.slice(0, MAX_ATTACHMENTS)) {
    if (f.size > MAX_ATTACHMENT_BYTES || !isAllowedMime(f.mime)) {
      skipped.push(f.name)
      continue
    }
    try {
      const got = await gmail<{ data?: string }>(token, `/messages/${id}/attachments/${f.attachmentId}`)
      const bytes = Buffer.from(got.data ?? '', 'base64url')
      if (!contentMatchesType(f.mime, bytes)) {
        skipped.push(f.name)
        continue
      }
      const saved = await saveAccountFile({ accountId, name: f.name, mime: f.mime, bytes })
      attachments.push({ file_id: saved.id, name: saved.original_name, url: saved.url, size: saved.size, mime: saved.mime_type })
    } catch {
      skipped.push(f.name)
    }
  }
  if (files.length > MAX_ATTACHMENTS) skipped.push(...files.slice(MAX_ATTACHMENTS).map((f) => f.name))
  if (!body && attachments.length === 0) return false

  const { ensureEmailColumns } = await import('@/lib/email/schema')
  await ensureEmailColumns().catch(() => {})
  const { processInbound } = await import('@/lib/email/ingest')
  await processInbound(accountId, ownerUserId, {
    fromEmail: from,
    subject: header(msg.payload, 'Subject').slice(0, 300),
    text: body || '(no text — see attachments)',
    html: null,
    providerMessageId: header(msg.payload, 'Message-ID') || `gmail:${msg.id}`,
    meta: {
      to: addressesIn(header(msg.payload, 'To')),
      cc: addressesIn(header(msg.payload, 'Cc')),
      ...(attachments.length ? { attachments } : {}),
      ...(skipped.length ? { skipped_attachments: skipped.slice(0, 20) } : {}),
    },
  })
  return true
}

const polling = new Set<string>()

/**
 * One read of one mailbox: everything added to the inbox since the stored
 * history id. The first run only records where "now" is — mail from
 * before Gmail was connected is not imported.
 */
export async function pollGmail(accountId: string): Promise<number> {
  if (polling.has(accountId)) return 0
  polling.add(accountId)
  try {
    if (!(await isGoogleServiceEnabled(accountId, 'gmail_inbox'))) return 0
    const conn = await prisma.googleConnection.findUnique({ where: { account_id: accountId } })
    if (!conn?.google_email) return 0
    const token = await googleAccessToken(accountId)

    if (!conn.gmail_history_id) {
      const profile = await gmail<{ historyId?: string }>(token, '/profile')
      await prisma.googleConnection.update({
        where: { id: conn.id },
        data: { gmail_history_id: profile.historyId ?? null, gmail_polled_at: new Date() },
      })
      await logGoogleActivity(accountId, null, 'gmail_started', `Reading new mail for ${conn.google_email} from now on`)
      return 0
    }

    type HistoryPage = { history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>; historyId?: string; nextPageToken?: string }
    const pages: HistoryPage[] = []
    try {
      let pageToken: string | undefined
      do {
        const page: HistoryPage = await gmail(
          token,
          `/history?startHistoryId=${encodeURIComponent(conn.gmail_history_id)}&historyTypes=messageAdded&labelId=INBOX&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        )
        pages.push(page)
        pageToken = page.nextPageToken
      } while (pageToken && pages.length < 5)
    } catch (err) {
      // A history id older than Gmail keeps (about a week) answers 404:
      // start again from now rather than failing every minute.
      if (err instanceof GmailError && err.status === 404) {
        const profile = await gmail<{ historyId?: string }>(token, '/profile')
        await prisma.googleConnection.update({ where: { id: conn.id }, data: { gmail_history_id: profile.historyId ?? null, gmail_polled_at: new Date() } })
        await logGoogleActivity(accountId, null, 'gmail_restarted', 'Gmail no longer had the last read position; reading from now on')
        return 0
      }
      throw err
    }

    const lastPage = pages[pages.length - 1]
    const ids = [...new Set(pages.flatMap((p) => p.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message?.id).filter((x): x is string => Boolean(x))))]
    let taken = 0
    for (const id of ids.slice(0, MAX_PER_POLL)) {
      try {
        if (await ingestMessage(accountId, conn.user_id, conn.google_email, token, id)) taken++
      } catch (err) {
        console.error('[gmail] could not bring in a message:', err instanceof Error ? err.message : err)
      }
    }
    // Read in full each time (up to five pages); a message seen before is
    // skipped on its headers, so moving on is always safe.
    const nextId = lastPage?.historyId ?? conn.gmail_history_id
    await prisma.googleConnection.update({ where: { id: conn.id }, data: { gmail_history_id: nextId, gmail_polled_at: new Date() } })
    return taken
  } finally {
    polling.delete(accountId)
  }
}

/** Every minute from server.ts: each account with "Gmail — full inbox" on. */
export async function sweepGmailInboxes(): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const conns = await prisma.googleConnection
    .findMany({ where: { status: 'connected', enabled_services: { has: 'gmail_inbox' } }, select: { account_id: true } })
    .catch(() => [])
  for (const c of conns) {
    await pollGmail(c.account_id).catch((err) => console.error('[gmail] poll failed:', err instanceof Error ? err.message : err))
  }
}
