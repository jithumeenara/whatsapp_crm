import { NextResponse } from 'next/server'
import { stat, readFile } from 'fs/promises'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { contentMatchesType } from '@/lib/files/account-files'
import { uploadPathFor } from '@/lib/whatsapp/media-ref'
import { insightAuth } from '@/lib/meta/social-insights'
import { publishableType } from '@/lib/meta/social-media-token'
import { ensurePostsTable, postProblem, sweepScheduledPosts, type PostMedia, type PostType, type PublishChannel } from '@/lib/meta/social-publish'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET  /api/social/posts            — the workspace's scheduled and recent posts
 * POST /api/social/posts            — publish now or at a set time
 *   { channels: ['instagram','facebook'], post_type, caption, media: ['/api/files/account-…/x.jpg'],
 *     scheduled_at?: ISO with offset, client_key: uuid }
 *
 * Supervisor+ with Social access (posting publicly as the business). Every
 * field is checked on the server: channels must be connected, media must be
 * this workspace's own uploads of a real JPEG/PNG/MP4/MOV (checked from the
 * bytes), Meta's rules per post type, time within the next 75 days.
 * client_key makes a double-clicked Publish one post.
 */

const KEY = /^[0-9a-f-]{16,64}$/i
const MAX_AHEAD_MS = 75 * 86_400_000
const MAX_FILE = 16 * 1024 * 1024

type Row = {
  id: string; channels: string[]; post_type: string; caption: string | null; media: unknown; status: string
  scheduled_at: Date; published_at: Date | null; results: unknown; created_at: Date
}

export async function GET() {
  try {
    const ctx = await requirePageAccess('/social', 'supervisor')
    await ensurePostsTable()
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id::text AS id, channels, post_type, caption, media, status, scheduled_at, published_at, results, created_at
      FROM social_posts WHERE account_id = ${ctx.accountId}::uuid
      ORDER BY scheduled_at DESC LIMIT 100`
    return NextResponse.json({
      posts: rows.map((r) => {
        const results = (r.results && typeof r.results === 'object' ? r.results : {}) as Record<string, { id?: string; error?: string }>
        return {
          id: r.id,
          channels: r.channels,
          post_type: r.post_type,
          caption: r.caption,
          media: (Array.isArray(r.media) ? r.media : []).map((m) => ({ link: String((m as PostMedia).link ?? ''), kind: (m as PostMedia).kind === 'video' ? 'video' : 'image' })),
          status: r.status,
          scheduled_at: r.scheduled_at,
          published_at: r.published_at,
          // Per channel: done or a plain reason — never Meta's raw text or ids beyond "done".
          outcome: Object.fromEntries(Object.entries(results).filter(([k]) => k === 'instagram' || k === 'facebook').map(([k, v]) => [k, v?.id ? 'published' : v?.error ?? 'pending'])),
        }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requirePageAccess('/social', 'supervisor')
    const limit = checkRateLimit(`social-post:${ctx.userId}`, RATE_LIMITS.apiWrite)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    // ── each field on its own ──
    const clientKey = typeof body.client_key === 'string' && KEY.test(body.client_key) ? body.client_key : null
    if (!clientKey) return NextResponse.json({ error: 'Refresh the page and try again.' }, { status: 400 })
    const rawChannels = Array.isArray(body.channels) ? body.channels : []
    const channels = [...new Set(rawChannels.filter((c): c is PublishChannel => c === 'instagram' || c === 'facebook'))]
    if (channels.length !== rawChannels.length || channels.length === 0) return NextResponse.json({ error: 'Choose Instagram, Facebook or both.' }, { status: 400 })
    const postType: PostType = body.post_type === 'reel' ? 'reel' : body.post_type === 'story' ? 'story' : 'feed'
    if (body.post_type !== undefined && body.post_type !== postType) return NextResponse.json({ error: 'Unknown post type.' }, { status: 400 })
    if (body.caption !== undefined && typeof body.caption !== 'string') return NextResponse.json({ error: 'The caption must be text.' }, { status: 400 })
    const caption = typeof body.caption === 'string' ? body.caption.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''
    const rawMedia = Array.isArray(body.media) ? body.media : []
    if (rawMedia.length > 10 || rawMedia.some((m) => typeof m !== 'string')) return NextResponse.json({ error: 'At most 10 pictures or videos.' }, { status: 400 })

    // Media: this workspace's own uploads, real type from the bytes.
    const media: PostMedia[] = []
    for (const link of rawMedia as string[]) {
      const type = publishableType(link)
      if (!type) return NextResponse.json({ error: 'Use JPEG or PNG pictures and MP4 or MOV videos.' }, { status: 400 })
      let path: string
      try { path = uploadPathFor(link, ctx.accountId) } catch { return NextResponse.json({ error: 'One of the files is not from this workspace. Upload it again.' }, { status: 400 }) }
      const info = await stat(path).catch(() => null)
      if (!info?.isFile() || info.size === 0) return NextResponse.json({ error: 'One of the files was not found. Upload it again.' }, { status: 400 })
      if (info.size > MAX_FILE) return NextResponse.json({ error: 'Each file can be at most 16 MB.' }, { status: 400 })
      const bytes = await readFile(path)
      if (!contentMatchesType(type.mime, bytes)) return NextResponse.json({ error: 'One of the files is not what its name says. Choose the original file.' }, { status: 400 })
      media.push({ link, kind: type.kind })
    }

    const problem = postProblem({ channels, postType, caption, media })
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    // When: now, or a moment the browser sent with its offset (ISO).
    let when = new Date()
    if (body.scheduled_at !== undefined && body.scheduled_at !== null) {
      const t = typeof body.scheduled_at === 'string' ? Date.parse(body.scheduled_at) : NaN
      if (!Number.isFinite(t)) return NextResponse.json({ error: 'Choose a valid date and time.' }, { status: 400 })
      if (t < Date.now() - 60_000) return NextResponse.json({ error: 'That time has already passed.' }, { status: 400 })
      if (t > Date.now() + MAX_AHEAD_MS) return NextResponse.json({ error: 'Schedule at most 75 days ahead.' }, { status: 400 })
      when = new Date(t)
    }

    for (const ch of channels) {
      if (!(await insightAuth(ctx.accountId, ch))) return NextResponse.json({ error: `${ch === 'instagram' ? 'Instagram' : 'The Facebook Page'} is not connected.` }, { status: 400 })
    }

    await ensurePostsTable()
    const rows = await prisma.$queryRaw<{ id: string; created: boolean }[]>`
      INSERT INTO social_posts (account_id, created_by, client_key, channels, post_type, caption, media, scheduled_at)
      VALUES (${ctx.accountId}::uuid, ${ctx.userId}::uuid, ${clientKey}, ${channels}::text[], ${postType}, ${caption || null}, ${JSON.stringify(media)}::jsonb, ${when})
      ON CONFLICT (account_id, client_key) DO UPDATE SET updated_at = social_posts.updated_at
      RETURNING id::text AS id, (xmax = 0) AS created`
    const row = rows[0]
    if (row?.created) {
      await audit(auditCtx(req, ctx), { action: 'message.sent', target: { type: 'social_post', id: row.id, label: null }, meta: { channels, post_type: postType, media: media.length, scheduled: body.scheduled_at ? true : false } })
    }
    // Publish-now posts go out at once (the minute job is the fallback).
    if (!body.scheduled_at) sweepScheduledPosts().catch((e: unknown) => console.error('[social publish] immediate run failed:', e instanceof Error ? e.message : e))
    return NextResponse.json({ ok: true, id: row?.id ?? null, duplicate: row ? !row.created : false })
  } catch (err) {
    return toErrorResponse(err)
  }
}
