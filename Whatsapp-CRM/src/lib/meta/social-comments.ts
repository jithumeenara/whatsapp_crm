/**
 * Comments on the workspace's Instagram posts and Facebook Page posts.
 *
 *  - The webhooks save each comment once (unique per workspace + Meta id).
 *  - The Comments screen answers them: public reply, one private reply by
 *    DM (Meta: once per comment, within 7 days), hide / unhide, delete.
 *
 * Safety rules kept here, not in each route:
 *  - every row is loaded with the workspace id; Meta ids used in a Graph
 *    URL come from our row and are checked to be digits / underscores;
 *  - text is checked for type, length and hidden characters;
 *  - links shown on screen are only instagram.com / facebook.com https
 *    addresses;
 *  - the private reply is claimed atomically before it is sent, so two
 *    clicks (or two people) can never send two;
 *  - Meta's own error text goes to the server log, never to the screen.
 */

import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from './versions'
import { explainMetaError, graphHost, messagesUrl, type SocialChannel } from './social-messaging'

export const PRIVATE_REPLY_DAYS = 7
const DAY_MS = 86_400_000

/** Meta comment / post / user ids: digits, sometimes joined by "_". */
export const META_ID = /^[0-9]{1,40}(_[0-9]{1,40})?$/

export const COMMENT_TEXT_MAX: Record<SocialChannel, number> = { instagram: 2200, facebook: 8000 }
export const PRIVATE_REPLY_MAX: Record<SocialChannel, number> = { instagram: 1000, facebook: 2000 }

export async function ensureSocialCommentsTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS social_comments (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      channel          TEXT        NOT NULL CHECK (channel IN ('instagram', 'facebook')),
      comment_id       TEXT        NOT NULL,
      parent_id        TEXT,
      post_id          TEXT,
      post_caption     TEXT,
      post_permalink   TEXT,
      from_id          TEXT,
      from_name        TEXT,
      contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
      text             TEXT,
      commented_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      is_hidden        BOOLEAN     NOT NULL DEFAULT false,
      deleted_at       TIMESTAMPTZ,
      status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
      private_reply_at TIMESTAMPTZ,
      private_reply_by UUID        REFERENCES users(id) ON DELETE RESTRICT,
      replies          JSONB       NOT NULL DEFAULT '[]'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT social_comments_one_per_account UNIQUE (account_id, channel, comment_id)
    )`.catch((e: unknown) => console.warn('[social comments] table not created:', e instanceof Error ? e.message : e))
}

/** Plain text from the browser or a webhook: a string, trimmed, no hidden characters. */
export function cleanText(raw: unknown, max: number): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Write a reply first.' }
  const text = raw.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (!text) return { ok: false, error: 'Write a reply first.' }
  if ([...text].length > max) return { ok: false, error: `A reply can be at most ${max} characters.` }
  return { ok: true, text }
}

/** Only a real Instagram / Facebook https link is ever shown as a link. */
export function safePermalink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const ok = u.protocol === 'https:' && !u.username && !u.password &&
      (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com')
    return ok ? u.toString() : null
  } catch {
    return null
  }
}

function clip(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? [...v.trim()].slice(0, max).join('') : null
}

// ── Saving what the webhooks bring ─────────────────────────────────────────

export interface IncomingComment {
  accountId: string
  channel: SocialChannel
  commentId: string
  parentId?: string | null
  postId?: string | null
  fromId?: string | null
  fromName?: string | null
  text?: string | null
  at?: Date | null
}

/**
 * Save (or, for an edit, update) one comment. Returns the row id, or null
 * when the ids are not Meta ids. A resent webhook only refreshes the text.
 */
export async function saveIncomingComment(c: IncomingComment): Promise<string | null> {
  if (!META_ID.test(c.commentId)) return null
  const parentId = c.parentId && META_ID.test(c.parentId) ? c.parentId : null
  const postId = c.postId && META_ID.test(c.postId) ? c.postId : null
  const fromId = c.fromId && META_ID.test(c.fromId) ? c.fromId : null
  const text = clip(c.text, COMMENT_TEXT_MAX[c.channel])
  const name = clip(c.fromName, 100)
  const at = c.at && Number.isFinite(c.at.getTime()) ? c.at : new Date()

  // A known customer: link the comment to their contact (never created here
  // — a comment alone does not make someone a contact).
  let contactId: string | null = null
  if (fromId) {
    const contact = await prisma.contact.findFirst({
      where: { account_id: c.accountId, ...(c.channel === 'instagram' ? { instagram_id: fromId } : { facebook_id: fromId }) },
      select: { id: true },
    }).catch(() => null)
    contactId = contact?.id ?? null
  }

  await ensureSocialCommentsTable()
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO social_comments (account_id, channel, comment_id, parent_id, post_id, from_id, from_name, contact_id, text, commented_at)
    VALUES (${c.accountId}::uuid, ${c.channel}, ${c.commentId}, ${parentId}, ${postId}, ${fromId}, ${name}, ${contactId}::uuid, ${text}, ${at})
    ON CONFLICT (account_id, channel, comment_id) DO UPDATE
      SET text = COALESCE(EXCLUDED.text, social_comments.text), updated_at = now()
    RETURNING id::text AS id`.catch((e: unknown) => {
    console.error('[social comments] save failed:', e instanceof Error ? e.message : e)
    return [] as { id: string }[]
  })
  return rows[0]?.id ?? null
}

/** Removed or hidden at Meta (by anyone): reflect it, keep the row. */
export async function markCommentAtMeta(accountId: string, channel: SocialChannel, commentId: string, change: 'removed' | 'hidden' | 'unhidden'): Promise<void> {
  if (!META_ID.test(commentId)) return
  if (change === 'removed') {
    await prisma.$executeRaw`UPDATE social_comments SET deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND comment_id = ${commentId}`.catch(() => 0)
  } else {
    const hidden = change === 'hidden'
    await prisma.$executeRaw`UPDATE social_comments SET is_hidden = ${hidden}, updated_at = now() WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND comment_id = ${commentId}`.catch(() => 0)
  }
}

/**
 * The post's caption and link, fetched once per post (best effort). Only an
 * instagram.com / facebook.com https link is stored.
 */
export async function fillPostDetails(accountId: string, channel: SocialChannel, postId: string | null | undefined, token: string | null | undefined): Promise<void> {
  if (!postId || !META_ID.test(postId) || !token) return
  const known = await prisma.$queryRaw<{ n: number }[]>`
    SELECT 1 AS n FROM social_comments WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND post_id = ${postId} AND post_permalink IS NOT NULL LIMIT 1`.catch(() => [])
  if (known.length > 0) {
    await prisma.$executeRaw`
      UPDATE social_comments c SET post_caption = k.post_caption, post_permalink = k.post_permalink
      FROM (SELECT post_caption, post_permalink FROM social_comments WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND post_id = ${postId} AND post_permalink IS NOT NULL LIMIT 1) k
      WHERE c.account_id = ${accountId}::uuid AND c.channel = ${channel} AND c.post_id = ${postId} AND c.post_permalink IS NULL`.catch(() => 0)
    return
  }
  const fields = channel === 'instagram' ? 'caption,permalink' : 'message,permalink_url'
  const res = await fetch(`${graphHost(channel, token)}/${postId}?fields=${fields}&access_token=${encodeURIComponent(token)}`, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return
  const data = (await res.json().catch(() => ({}))) as { caption?: string; message?: string; permalink?: string; permalink_url?: string }
  const caption = clip(data.caption ?? data.message, 300)
  const link = safePermalink(data.permalink ?? data.permalink_url)
  await prisma.$executeRaw`
    UPDATE social_comments SET post_caption = ${caption}, post_permalink = ${link}
    WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND post_id = ${postId}`.catch(() => 0)
}

// ── Answering from the Comments screen ─────────────────────────────────────

export interface CommentRow {
  id: string
  channel: SocialChannel
  comment_id: string
  from_id: string | null
  from_name: string | null
  commented_at: Date
  private_reply_at: Date | null
  deleted_at: Date | null
  is_hidden: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One comment of this workspace, or null (wrong id, other workspace, removed). */
export async function loadComment(accountId: string, id: string): Promise<CommentRow | null> {
  if (!UUID.test(id)) return null
  const rows = await prisma.$queryRaw<CommentRow[]>`
    SELECT id::text AS id, channel, comment_id, from_id, from_name, commented_at, private_reply_at, deleted_at, is_hidden
    FROM social_comments WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid LIMIT 1`.catch(() => [] as CommentRow[])
  const row = rows[0]
  if (!row || !META_ID.test(row.comment_id)) return null
  return row
}

export interface ChannelAuth { token: string; igAccountId: string | null; pageId: string | null }

/** The workspace's own token for a channel (never sent to the browser). */
export async function channelAuth(accountId: string, channel: SocialChannel): Promise<ChannelAuth | null> {
  const rows = channel === 'instagram'
    ? await prisma.$queryRaw<{ access_token: string | null; instagram_account_id: string | null; page_id: string | null }[]>`
        SELECT access_token, instagram_account_id, page_id FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1`.catch(() => [])
    : await prisma.$queryRaw<{ access_token: string | null; instagram_account_id: string | null; page_id: string | null }[]>`
        SELECT access_token, NULL::text AS instagram_account_id, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1`.catch(() => [])
  const row = rows[0]
  const token = openStoredSecret(row?.access_token ?? null)
  if (!token) return null
  const igAccountId = row?.instagram_account_id && META_ID.test(row.instagram_account_id) ? row.instagram_account_id : null
  const pageId = row?.page_id && META_ID.test(row.page_id) ? row.page_id : null
  return { token, igAccountId, pageId }
}

type MetaErr = { message?: string; code?: number; error_subcode?: number }

async function graphCall(method: 'POST' | 'DELETE', url: string, token: string, body?: Record<string, string>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() } : {}),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'Could not reach Meta. Try again in a minute.' }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: MetaErr }
  if (!res.ok || data.error) {
    console.error('[social comments] Meta error:', res.status, data.error?.code, data.error?.error_subcode, data.error?.message)
    return { ok: false, error: explainMetaError(data.error, res.status) }
  }
  return { ok: true, data }
}

/** A public reply under the comment. Returns Meta's id for the reply. */
export async function replyPublicly(c: CommentRow, auth: ChannelAuth, text: string): Promise<{ ok: true; replyId: string | null } | { ok: false; error: string }> {
  const url = c.channel === 'instagram'
    ? `${graphHost('instagram', auth.token)}/${c.comment_id}/replies`
    : `https://graph.facebook.com/${GRAPH_API_VERSION}/${c.comment_id}/comments`
  const r = await graphCall('POST', url, auth.token, { message: text })
  if (!r.ok) return r
  const id = typeof r.data.id === 'string' && META_ID.test(r.data.id) ? r.data.id : null
  return { ok: true, replyId: id }
}

export async function setHidden(c: CommentRow, auth: ChannelAuth, hidden: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = c.channel === 'instagram'
    ? `${graphHost('instagram', auth.token)}/${c.comment_id}`
    : `https://graph.facebook.com/${GRAPH_API_VERSION}/${c.comment_id}`
  const r = await graphCall('POST', url, auth.token, c.channel === 'instagram' ? { hide: String(hidden) } : { is_hidden: String(hidden) })
  return r.ok ? { ok: true } : r
}

export async function deleteAtMeta(c: CommentRow, auth: ChannelAuth): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = c.channel === 'instagram'
    ? `${graphHost('instagram', auth.token)}/${c.comment_id}`
    : `https://graph.facebook.com/${GRAPH_API_VERSION}/${c.comment_id}`
  const r = await graphCall('DELETE', url, auth.token)
  return r.ok ? { ok: true } : r
}

/** Is the private reply still allowed for this comment (pure)? */
export function privateReplyOpen(c: Pick<CommentRow, 'commented_at' | 'private_reply_at' | 'deleted_at'>, now: Date): boolean {
  return !c.private_reply_at && !c.deleted_at && now.getTime() - new Date(c.commented_at).getTime() <= PRIVATE_REPLY_DAYS * DAY_MS
}

/**
 * Claim the one private reply for this comment. Atomic: only the first of
 * two clicks (or two people) gets true. Released again if Meta refuses.
 */
export async function claimPrivateReply(accountId: string, id: string, userId: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE social_comments SET private_reply_at = now(), private_reply_by = ${userId}::uuid, updated_at = now()
    WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid AND private_reply_at IS NULL AND deleted_at IS NULL
      AND commented_at > now() - make_interval(days => ${PRIVATE_REPLY_DAYS})`
  return n === 1
}

export async function releasePrivateReply(accountId: string, id: string, userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE social_comments SET private_reply_at = NULL, private_reply_by = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid AND private_reply_by = ${userId}::uuid`.catch(() => 0)
}

/** Send the private reply (Meta: recipient = the comment). */
export async function sendPrivateReply(c: CommentRow, auth: ChannelAuth, text: string): Promise<{ ok: true; recipientId: string | null; messageId: string | null } | { ok: false; error: string }> {
  const url = messagesUrl({ channel: c.channel, token: auth.token, igAccountId: auth.igAccountId, pageId: auth.pageId })
  const res = await fetch(`${url}?access_token=${encodeURIComponent(auth.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { comment_id: c.comment_id }, message: { text } }),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'Could not reach Meta. Try again in a minute.' }
  const data = (await res.json().catch(() => ({}))) as { recipient_id?: string; message_id?: string; error?: MetaErr }
  if (!res.ok || data.error) {
    console.error('[social comments] private reply refused:', res.status, data.error?.code, data.error?.error_subcode, data.error?.message)
    return { ok: false, error: explainMetaError(data.error, res.status) }
  }
  const recipientId = typeof data.recipient_id === 'string' && META_ID.test(data.recipient_id) ? data.recipient_id : null
  return { ok: true, recipientId, messageId: typeof data.message_id === 'string' ? data.message_id.slice(0, 300) : null }
}

/**
 * After a private reply: the customer's chat in the Inbox (found or made),
 * with the reply in it, so their answer continues there.
 */
export async function recordPrivateReplyInInbox(input: {
  accountId: string; channel: SocialChannel; recipientId: string; name: string | null; userId: string; text: string; messageId: string | null
}): Promise<{ conversationId: string; contactId: string } | null> {
  const owner = await prisma.profile.findFirst({ where: { account_id: input.accountId }, orderBy: { created_at: 'asc' }, select: { user_id: true } })
  if (!owner) return null
  const idField = input.channel === 'instagram' ? 'instagram_id' : 'facebook_id'
  let contact = await prisma.contact.findFirst({ where: { account_id: input.accountId, [idField]: input.recipientId }, select: { id: true } })
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        account_id: input.accountId,
        user_id: owner.user_id,
        phone: input.recipientId,
        phone_normalized: input.recipientId.replace(/\D/g, ''),
        [idField]: input.recipientId,
        name: input.name ?? input.recipientId,
        opt_in_status: 'opted_in',
        opt_in_source: `${input.channel}_comment`,
        opt_in_at: new Date(),
      },
      select: { id: true },
    }).catch(async () => prisma.contact.findFirst({ where: { account_id: input.accountId, [idField]: input.recipientId }, select: { id: true } }))
    if (!contact) return null
  }
  let conv = await prisma.conversation.findFirst({ where: { account_id: input.accountId, contact_id: contact.id, channel: input.channel }, select: { id: true } })
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { account_id: input.accountId, user_id: owner.user_id, contact_id: contact.id, channel: input.channel },
      select: { id: true },
    }).catch(async () => prisma.conversation.findFirst({ where: { account_id: input.accountId, contact_id: contact!.id, channel: input.channel }, select: { id: true } }))
    if (!conv) return null
  }
  await prisma.message.create({
    data: { conversation_id: conv.id, sender_type: 'agent', sender_id: input.userId, content_type: 'text', content_text: input.text, message_id: input.messageId, status: 'sent' },
  })
  await prisma.conversation.update({ where: { id: conv.id }, data: { last_message_text: input.text, last_message_at: new Date() } }).catch(() => null)
  return { conversationId: conv.id, contactId: contact.id }
}
