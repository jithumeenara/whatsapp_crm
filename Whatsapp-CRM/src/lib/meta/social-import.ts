/**
 * Bring recent Messenger / Instagram conversations into the Inbox (Meta's
 * Conversations API), so a newly connected Page or account does not start
 * empty.
 *
 * Bounded (50 conversations × 25 messages), idempotent (a message already
 * saved — same Meta id in that chat — is skipped), and quiet: nothing here
 * runs a chatbot, an automation or the AI, and unread counts are not
 * touched. Only the workspace's own token is used; "next" links are
 * followed only on Meta's own hosts. Names are capped, text is plain.
 */

import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from './versions'
import { isFacebookToken, type SocialChannel } from './social-messaging'
import { safeGraphUrl } from './social-insights'

const ID = /^[0-9]{1,40}$/
export const IMPORT_LIMITS = { conversations: 50, messages: 25 } as const

interface Source { token: string; selfIds: Set<string>; listUrl: string; idField: 'instagram_id' | 'facebook_id' }

async function sourceFor(accountId: string, channel: SocialChannel): Promise<Source | null> {
  if (channel === 'facebook') {
    const rows = await prisma.$queryRaw<{ access_token: string | null; page_id: string | null }[]>`
      SELECT access_token, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid AND status = 'connected' LIMIT 1`.catch(() => [])
    const token = openStoredSecret(rows[0]?.access_token ?? null)
    const page = rows[0]?.page_id
    if (!token || !page || !ID.test(page)) return null
    return { token, selfIds: new Set([page]), idField: 'facebook_id', listUrl: `https://graph.facebook.com/${GRAPH_API_VERSION}/${page}/conversations?platform=messenger` }
  }
  const rows = await prisma.$queryRaw<{ access_token: string | null; instagram_account_id: string | null; page_id: string | null }[]>`
    SELECT access_token, instagram_account_id, page_id FROM instagram_config WHERE account_id = ${accountId}::uuid AND status = 'connected' LIMIT 1`.catch(() => [])
  const token = openStoredSecret(rows[0]?.access_token ?? null)
  if (!token) return null
  const ig = rows[0]?.instagram_account_id && ID.test(rows[0].instagram_account_id) ? rows[0].instagram_account_id : null
  const page = rows[0]?.page_id && ID.test(rows[0].page_id) ? rows[0].page_id : null
  const selfIds = new Set([ig, page].filter((x): x is string => Boolean(x)))
  if (isFacebookToken(token)) {
    if (!page) return null // Instagram conversations hang off the linked Page for Facebook-login tokens
    return { token, selfIds, idField: 'instagram_id', listUrl: `https://graph.facebook.com/${GRAPH_API_VERSION}/${page}/conversations?platform=instagram` }
  }
  return { token, selfIds, idField: 'instagram_id', listUrl: `https://graph.instagram.com/${GRAPH_API_VERSION}/me/conversations?platform=instagram` }
}

type Msg = { id?: unknown; created_time?: unknown; message?: unknown; from?: { id?: unknown } }
type Conv = { participants?: { data?: Array<{ id?: unknown; name?: unknown; username?: unknown }> }; messages?: { data?: Msg[] } }

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? [...v.trim()].slice(0, n).join('') : null)

export async function importConversations(accountId: string, channel: SocialChannel): Promise<{ conversations: number; messages: number } | { error: string }> {
  const src = await sourceFor(accountId, channel)
  if (!src) return { error: `${channel === 'instagram' ? 'Instagram' : 'The Facebook Page'} is not connected (or Test Connection has not run).` }
  const owner = await prisma.profile.findFirst({ where: { account_id: accountId }, orderBy: { created_at: 'asc' }, select: { user_id: true } })
  if (!owner) return { error: 'This workspace has no owner.' }

  const fields = `participants,updated_time,messages.limit(${IMPORT_LIMITS.messages}){id,created_time,from,message}`
  let url: string | null = `${src.listUrl}&fields=${encodeURIComponent(fields)}&limit=25`
  let convCount = 0, msgCount = 0

  while (url && convCount < IMPORT_LIMITS.conversations) {
    const res: Response | null = await fetch(`${url}${url.includes('access_token=') ? '' : `&access_token=${encodeURIComponent(src.token)}`}`, { cache: 'no-store' }).catch(() => null)
    const page = (await res?.json().catch(() => null)) as { data?: Conv[]; paging?: { next?: unknown }; error?: { code?: number; message?: string } } | null
    if (!res?.ok || !page || page.error) {
      console.error('[social import] Meta refused the conversation list:', res?.status, page?.error?.code, page?.error?.message)
      if (convCount === 0) return { error: 'Meta did not return conversations. The connection may lack the messaging permission.' }
      break
    }
    for (const conv of page.data ?? []) {
      if (convCount >= IMPORT_LIMITS.conversations) break
      const person = (conv.participants?.data ?? []).find((p) => typeof p.id === 'string' && ID.test(p.id) && !src.selfIds.has(p.id))
      if (!person || typeof person.id !== 'string') continue
      const personId = person.id
      const name = clip(person.name ?? person.username, 100)

      let contact = await prisma.contact.findFirst({ where: { account_id: accountId, [src.idField]: personId }, select: { id: true } })
      if (!contact) {
        contact = await prisma.contact.create({
          data: { account_id: accountId, user_id: owner.user_id, phone: personId, phone_normalized: personId, [src.idField]: personId, name: name ?? personId, opt_in_status: 'opted_in', opt_in_source: `${channel}_import`, opt_in_at: new Date() },
          select: { id: true },
        }).catch(async () => prisma.contact.findFirst({ where: { account_id: accountId, [src.idField]: personId }, select: { id: true } }))
        if (!contact) continue
      }
      let conversation = await prisma.conversation.findFirst({ where: { account_id: accountId, contact_id: contact.id, channel }, select: { id: true } })
      if (!conversation) {
        conversation = await prisma.conversation.create({ data: { account_id: accountId, user_id: owner.user_id, contact_id: contact.id, channel }, select: { id: true } })
          .catch(async () => prisma.conversation.findFirst({ where: { account_id: accountId, contact_id: contact!.id, channel }, select: { id: true } }))
        if (!conversation) continue
      }
      convCount++

      let newest: { at: Date; text: string } | null = null
      for (const m of conv.messages?.data ?? []) {
        const mid = typeof m.id === 'string' && m.id.length <= 300 ? m.id : null
        if (!mid) continue
        const at = typeof m.created_time === 'string' ? new Date(m.created_time) : null
        if (!at || !Number.isFinite(at.getTime())) continue
        const exists = await prisma.message.findFirst({ where: { conversation_id: conversation.id, message_id: mid }, select: { id: true } })
        if (exists) continue
        const fromSelf = typeof m.from?.id === 'string' && src.selfIds.has(m.from.id)
        const text = clip(m.message, 4000) ?? '[attachment]'
        await prisma.message.create({
          data: {
            conversation_id: conversation.id,
            sender_type: fromSelf ? 'agent' : 'customer',
            ...(fromSelf ? { bot_source: 'native_app' } : {}),
            content_type: 'text', content_text: text, message_id: mid, status: fromSelf ? 'sent' : 'delivered', created_at: at,
          },
        }).catch(() => null)
        msgCount++
        if (!newest || at > newest.at) newest = { at, text }
      }
      if (newest) {
        // Only moves forward: never overwrite a newer real message.
        await prisma.conversation.updateMany({
          where: { id: conversation.id, OR: [{ last_message_at: null }, { last_message_at: { lt: newest.at } }] },
          data: { last_message_at: newest.at, last_message_text: newest.text.slice(0, 200) },
        }).catch(() => null)
      }
    }
    url = safeGraphUrl(page.paging?.next)
  }
  return { conversations: convCount, messages: msgCount }
}
