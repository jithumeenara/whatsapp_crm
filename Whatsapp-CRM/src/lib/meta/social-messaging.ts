/**
 * Messenger and Instagram sending — where to send, to whom, and whether
 * Meta's window allows it. One place, so every send path (bot, AI, flows,
 * automations, agent replies) behaves the same.
 *
 * Hosts (Meta, Nov 2026):
 *  - An Instagram Login token (IGAA…, older IGQ…) works only on
 *    graph.instagram.com, as /me.
 *  - Every other Instagram token is a Facebook-family token (EAA…): a Page
 *    token, a System User token or a Unified Login (Business Integration
 *    System User) token. Those work only on graph.facebook.com, addressed by
 *    the Instagram professional account id ("Instagram User access tokens
 *    and graph.instagram.com don't work with" Unified Login).
 *  - Messenger always uses graph.facebook.com, addressed by the Page id.
 *
 * Window: 24 hours after the customer's last message; a person may reply up
 * to 7 days with the HUMAN_AGENT tag once Meta has approved the Human Agent
 * feature for the app.
 */

import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'

/** Phase 1 moves every messaging call to v27.0 (v21.0 is removed 21 Jan 2027). */
export const MESSAGING_GRAPH_VERSION = 'v21.0'

export type SocialChannel = 'instagram' | 'facebook'

/** Facebook-family tokens start with EAA; everything else is an Instagram Login token. */
export function isFacebookToken(token: string): boolean {
  return token.trim().startsWith('EAA')
}

const NUMERIC_ID = /^\d{1,30}$/

/**
 * The Send API address for this channel and token. Ids are checked to be
 * numeric so a stored value can never change the path.
 */
export function messagesUrl(input: {
  channel: SocialChannel
  token: string
  igAccountId?: string | null
  pageId?: string | null
}): string {
  const v = MESSAGING_GRAPH_VERSION
  const ig = input.igAccountId && NUMERIC_ID.test(input.igAccountId) ? input.igAccountId : null
  const page = input.pageId && NUMERIC_ID.test(input.pageId) ? input.pageId : null
  if (input.channel === 'instagram') {
    if (!isFacebookToken(input.token)) return `https://graph.instagram.com/${v}/me/messages`
    if (ig) return `https://graph.facebook.com/${v}/${ig}/messages`
    if (page) return `https://graph.facebook.com/${v}/${page}/messages`
    return `https://graph.facebook.com/${v}/me/messages`
  }
  return page ? `https://graph.facebook.com/${v}/${page}/messages` : `https://graph.facebook.com/${v}/me/messages`
}

/** The host for other reads (a user's name, the profile) with this token. */
export function graphHost(channel: SocialChannel, token: string): string {
  return channel === 'instagram' && !isFacebookToken(token)
    ? `https://graph.instagram.com/${MESSAGING_GRAPH_VERSION}`
    : `https://graph.facebook.com/${MESSAGING_GRAPH_VERSION}`
}

/**
 * An Instagram account node (profile, media, insights, messenger_profile):
 * /me on graph.instagram.com for an Instagram Login token, the account id on
 * graph.facebook.com for any other token. `path` starts with "/" or "?".
 * Returns null when an EAA token has no usable account id saved.
 */
export function igNodeUrl(token: string, igAccountId: string | null | undefined, path = ''): string | null {
  if (!isFacebookToken(token)) return `https://graph.instagram.com/${MESSAGING_GRAPH_VERSION}/me${path}`
  if (!igAccountId || !NUMERIC_ID.test(igAccountId)) return null
  return `https://graph.facebook.com/${MESSAGING_GRAPH_VERSION}/${igAccountId}${path}`
}

/**
 * Who receives the message: the Instagram-scoped id (IGSID) or Page-scoped
 * id (PSID) kept on the contact. Older Instagram contacts kept the IGSID in
 * `phone` only, so a purely numeric phone is the fallback; a real phone
 * number (with +) is never sent to Meta as a user id.
 */
export function recipientIdFor(
  channel: SocialChannel,
  contact: { instagram_id?: string | null; facebook_id?: string | null; phone?: string | null },
): string | null {
  const own = channel === 'instagram' ? contact.instagram_id : contact.facebook_id
  if (own && NUMERIC_ID.test(own)) return own
  const phone = contact.phone?.trim() ?? ''
  if (NUMERIC_ID.test(phone)) return phone
  return null
}

const DAY_MS = 24 * 60 * 60 * 1000

export type WindowDecision =
  | { ok: true; tag: null }
  | { ok: true; tag: 'HUMAN_AGENT' }
  | { ok: false; reason: string }

/** May a message go now? Pure. `humanAgent`: the app has the Human Agent feature. */
export function windowDecision(lastInboundAt: Date | null, now: Date, humanAgent: boolean): WindowDecision {
  if (!lastInboundAt || Number.isNaN(lastInboundAt.getTime())) {
    return { ok: false, reason: 'This person has not messaged you yet. Meta lets a business reply only after the customer writes first.' }
  }
  const age = now.getTime() - lastInboundAt.getTime()
  if (age <= DAY_MS) return { ok: true, tag: null }
  if (humanAgent && age <= 7 * DAY_MS) return { ok: true, tag: 'HUMAN_AGENT' }
  return {
    ok: false,
    reason: humanAgent
      ? 'More than 7 days have passed since the customer last wrote. Meta allows no reply until they message again.'
      : 'More than 24 hours have passed since the customer last wrote. Meta allows no reply until they message again (or turn on Human agent replies once Meta approves it).',
  }
}

/** Meta's error, in words a person can act on. */
export function explainMetaError(err: { message?: string; code?: number; error_subcode?: number } | undefined, status: number): string {
  const code = err?.code
  const sub = err?.error_subcode
  if (code === 190) return 'The Meta connection has expired or was removed. Reconnect in Settings → Channels.'
  if (code === 200 && /Direct Messaging|Allow access/i.test(err?.message ?? '')) {
    return 'Instagram blocked the message: turn on "Allow access to messages" in the Instagram app (Settings → Messages and story replies → Message controls).'
  }
  if (code === 10 && (sub === 2018278 || sub === 2534022)) return 'Outside Meta\'s reply window: the customer must message again first.'
  if (code === 10 && sub === 2018300) return 'Meta Business AI is handling this chat. Take the chat back in Meta Business Suite, or wait for it to hand over.'
  if (code === 100 && sub === 2534037) return 'Meta Business AI owns this chat. Turn on "Take control of conversations with your Business AI" or wait for the handover.'
  if (code === 551) return 'This person is not available on Messenger/Instagram right now.'
  if (code === 613 || code === 4) return 'Meta is limiting how fast messages can be sent. Try again in a minute.'
  return err?.message ? `Meta refused the message: ${err.message}` : `Meta refused the message (${status}).`
}

export interface SocialTarget {
  channel: SocialChannel
  token: string
  url: string
  recipientId: string
  igAccountId: string | null
  pageId: string | null
}

/**
 * Everything needed to send to this conversation, read for this account
 * only. Throws a plain-language error when the channel is not connected or
 * the contact has no Meta id.
 */
export async function loadSocialTarget(accountId: string, contactId: string, channel: SocialChannel): Promise<SocialTarget> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, account_id: accountId },
    select: { phone: true, instagram_id: true, facebook_id: true },
  }) as { phone?: string | null; instagram_id?: string | null; facebook_id?: string | null } | null
  if (!contact) throw new Error(channel === 'instagram' ? 'Instagram contact not found' : 'Messenger contact not found')

  const rows = channel === 'instagram'
    ? await prisma.$queryRaw<{ access_token: string | null; instagram_account_id?: string | null; page_id?: string | null }[]>`
        SELECT access_token, instagram_account_id, page_id FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1`
    : await prisma.$queryRaw<{ access_token: string | null; page_id?: string | null }[]>`
        SELECT access_token, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1`
  const row = rows[0] as { access_token: string | null; instagram_account_id?: string | null; page_id?: string | null } | undefined
  const token = openStoredSecret(row?.access_token ?? null)
  if (!token) throw new Error(channel === 'instagram' ? 'Instagram not configured for this account' : 'Messenger not configured for this account')

  const recipientId = recipientIdFor(channel, contact)
  if (!recipientId) throw new Error(channel === 'instagram' ? 'This contact has no Instagram id to message.' : 'This contact has no Messenger id to message.')

  const igAccountId = row?.instagram_account_id ?? null
  const pageId = row?.page_id ?? null
  return { channel, token, recipientId, igAccountId, pageId, url: messagesUrl({ channel, token, igAccountId, pageId }) }
}

/** POST to the Send API. Returns Meta's message id; throws a readable error. */
export async function socialPost(target: SocialTarget, body: Record<string, unknown>): Promise<{ messageId: string | null }> {
  const res = await fetch(`${target.url}?access_token=${encodeURIComponent(target.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
  if (!res.ok || data.error) {
    console.error(`[${target.channel} send] Meta error:`, res.status, data.error?.code, data.error?.error_subcode, data.error?.message)
    throw new Error(explainMetaError(data.error, res.status))
  }
  return { messageId: data.message_id ?? null }
}

/** typing_on / typing_off / mark_seen. Never throws: it must not block a send. */
export async function socialSenderAction(target: SocialTarget, action: 'typing_on' | 'typing_off' | 'mark_seen'): Promise<void> {
  await fetch(`${target.url}?access_token=${encodeURIComponent(target.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: target.recipientId }, sender_action: action }),
  }).catch((e) => console.warn(`[${target.channel} sender action] skipped:`, e?.message))
}

/** messaging_type / tag for a send, from the window decision. */
export function envelopeFor(decision: WindowDecision): Record<string, string> {
  return decision.ok && decision.tag === 'HUMAN_AGENT'
    ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
    : { messaging_type: 'RESPONSE' }
}

/**
 * Has the business turned on Human agent replies for this channel (allowed
 * once Meta approves the Human Agent feature)? Off when the setting or its
 * column does not exist yet.
 */
export async function humanAgentEnabled(accountId: string, channel: SocialChannel): Promise<boolean> {
  try {
    const rows = channel === 'instagram'
      ? await prisma.$queryRaw<{ human_agent_enabled: boolean | null }[]>`
          SELECT human_agent_enabled FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1`
      : await prisma.$queryRaw<{ human_agent_enabled: boolean | null }[]>`
          SELECT human_agent_enabled FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1`
    return rows[0]?.human_agent_enabled === true
  } catch {
    return false
  }
}

/**
 * An image, video, audio file or document. A public https link is passed to
 * Meta; this account's own upload (/api/files/…, behind sign-in, so Meta
 * cannot fetch it) is read from disk and sent as multipart — never another
 * account's file (resolveUploadPath refuses it before anything is read).
 */
export async function socialSendAttachment(
  target: SocialTarget,
  accountId: string,
  kind: 'image' | 'video' | 'audio' | 'document',
  link: string,
  envelope: Record<string, string> = { messaging_type: 'RESPONSE' },
): Promise<{ messageId: string | null }> {
  const type = kind === 'document' ? 'file' : kind
  if (/^https:\/\//i.test(link)) {
    return socialPost(target, { recipient: { id: target.recipientId }, message: { attachment: { type, payload: { url: link, is_reusable: true } } }, ...envelope })
  }
  const [{ readFile }, { basename }, { lookup }, { resolveUploadPath }] = await Promise.all([
    import('fs/promises'), import('path'), import('mime-types'), import('@/lib/whatsapp/media-ref'),
  ])
  const filePath = await resolveUploadPath(link, accountId)
  const fileBuffer = await readFile(filePath)
  const filename = basename(filePath)
  const mimeType = (lookup(filename) || 'application/octet-stream') as string
  const form = new FormData()
  form.append('recipient', JSON.stringify({ id: target.recipientId }))
  form.append('message', JSON.stringify({ attachment: { type, payload: { is_reusable: true } } }))
  form.append('filedata', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename)
  for (const [k, v] of Object.entries(envelope)) form.append(k, v)
  const res = await fetch(`${target.url}?access_token=${encodeURIComponent(target.token)}`, { method: 'POST', body: form })
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
  if (!res.ok || data.error) {
    console.error(`[${target.channel} attachment] Meta error:`, res.status, data.error?.code, data.error?.message)
    throw new Error(explainMetaError(data.error, res.status))
  }
  return { messageId: data.message_id ?? null }
}

/** When the customer last wrote in this conversation (for the window). */
export async function lastInboundAt(conversationId: string): Promise<Date | null> {
  const row = await prisma.message.findFirst({
    where: { conversation_id: conversationId, sender_type: 'customer' },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  })
  return row?.created_at ?? null
}
