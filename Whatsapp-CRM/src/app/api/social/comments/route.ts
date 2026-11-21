import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { ensureSocialCommentsTable, privateReplyOpen, safePermalink } from '@/lib/meta/social-comments'

/**
 * GET /api/social/comments?status=open|done|all&channel=instagram|facebook&before=<iso>
 *
 * The Comments screen's list, newest first, 50 at a time, for the caller's
 * own workspace only. Returns just what the screen shows — no tokens, no
 * Meta ids beyond what is needed.
 */

type Row = {
  id: string; channel: 'instagram' | 'facebook'; parent_id: string | null; post_caption: string | null; post_permalink: string | null
  from_name: string | null; contact_id: string | null; text: string | null; commented_at: Date; is_hidden: boolean
  deleted_at: Date | null; status: string; private_reply_at: Date | null; replies: unknown; kind: string
}

const PAGE = 50

export async function GET(req: Request) {
  try {
    const ctx = await requirePageAccess('/comments', 'viewer')
    const q = new URL(req.url).searchParams
    const statusRaw = q.get('status') ?? 'open'
    const status = statusRaw === 'done' || statusRaw === 'all' ? statusRaw : 'open'
    const channelRaw = q.get('channel')
    const channel = channelRaw === 'instagram' || channelRaw === 'facebook' ? channelRaw : null
    const beforeRaw = q.get('before')
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : new Date('9999-01-01T00:00:00Z')

    await ensureSocialCommentsTable()
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id::text AS id, channel, parent_id, post_caption, post_permalink, from_name, contact_id::text AS contact_id,
             text, commented_at, is_hidden, deleted_at, status, private_reply_at, replies, COALESCE(kind, 'comment') AS kind
      FROM social_comments
      WHERE account_id = ${ctx.accountId}::uuid
        AND deleted_at IS NULL
        AND commented_at < ${before}
        AND (${status} = 'all' OR status = ${status})
        AND (${channel}::text IS NULL OR channel = ${channel})
      ORDER BY commented_at DESC
      LIMIT ${PAGE + 1}`
    const now = new Date()
    const page = rows.slice(0, PAGE)
    return NextResponse.json({
      comments: page.map((r) => ({
        id: r.id,
        channel: r.channel,
        kind: r.kind === 'mention' ? 'mention' : 'comment',
        is_reply: Boolean(r.parent_id),
        post_caption: r.post_caption,
        post_link: safePermalink(r.post_permalink),
        from_name: r.from_name,
        contact_id: r.contact_id,
        text: r.text,
        commented_at: r.commented_at,
        is_hidden: r.is_hidden,
        status: r.status,
        private_replied: Boolean(r.private_reply_at),
        can_private_reply: r.kind !== 'mention' && privateReplyOpen(r, now),
        replies: (Array.isArray(r.replies) ? r.replies : []).slice(-20).map((x) => {
          const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
          return { text: typeof o.text === 'string' ? o.text : '', at: typeof o.at === 'string' ? o.at : null }
        }),
      })),
      next_before: rows.length > PAGE ? page[page.length - 1]?.commented_at ?? null : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
