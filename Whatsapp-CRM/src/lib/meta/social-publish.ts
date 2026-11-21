/**
 * Publishing a post to the workspace's Instagram account and Facebook Page,
 * now or at a set time.
 *
 *  - Instagram takes media only by URL: each file gets a signed 30-minute
 *    public link (social-media-token.ts); a container is made, a video is
 *    waited on until Meta finishes it, then published.
 *  - Facebook gets the bytes uploaded directly (no public link needed).
 *  - The minute job claims due posts with FOR UPDATE SKIP LOCKED, so one
 *    post never goes out twice; each channel's result is kept, so a retry
 *    skips a channel that already published.
 *  - Meta's own error words go to the server log; the post records plain
 *    words.
 *
 * Imported by server.ts: no next/server here or below.
 */

import { readFile } from 'fs/promises'
import { prisma } from '@/lib/db'
import { uploadPathFor } from '@/lib/whatsapp/media-ref'
import { GRAPH_API_VERSION } from './versions'
import { explainMetaError, graphHost } from './social-messaging'
import { insightAuth, type InsightAuth } from './social-insights'
import { publicMediaUrl, publishableType } from './social-media-token'

export type PublishChannel = 'instagram' | 'facebook'
export type PostType = 'feed' | 'reel' | 'story'
export interface PostMedia { link: string; kind: 'image' | 'video' }
export interface ChannelResult { id?: string; error?: string; container?: string; at?: string }

export interface PostRow {
  id: string
  account_id: string
  channels: string[]
  post_type: PostType
  caption: string | null
  media: PostMedia[]
  results: Record<string, ChannelResult>
  attempts: number
}

export const CAPTION_MAX: Record<PublishChannel, number> = { instagram: 2200, facebook: 63000 }
const META_ID = /^[0-9]{1,40}(_[0-9]{1,40})?$/
const MAX_ATTEMPTS = 3

export async function ensurePostsTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS social_posts (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_by    UUID        REFERENCES users(id) ON DELETE RESTRICT,
      client_key    TEXT        NOT NULL,
      channels      TEXT[]      NOT NULL,
      post_type     TEXT        NOT NULL DEFAULT 'feed' CHECK (post_type IN ('feed', 'reel', 'story')),
      caption       TEXT,
      media         JSONB       NOT NULL DEFAULT '[]'::jsonb,
      status        TEXT        NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled')),
      scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_at     TIMESTAMPTZ,
      attempts      INTEGER     NOT NULL DEFAULT 0,
      results       JSONB       NOT NULL DEFAULT '{}'::jsonb,
      published_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT social_posts_one_per_click UNIQUE (account_id, client_key)
    )`.catch((e: unknown) => console.warn('[social publish] table not created:', e instanceof Error ? e.message : e))
}

/**
 * Pure: is this combination something Meta accepts? Returns a plain reason
 * when not. Media must already be checked as this workspace's uploads.
 */
export function postProblem(p: { channels: PublishChannel[]; postType: PostType; caption: string; media: PostMedia[] }): string | null {
  if (p.channels.length === 0) return 'Choose Instagram, Facebook or both.'
  for (const ch of p.channels) {
    if ([...p.caption].length > CAPTION_MAX[ch]) return `The caption is too long for ${ch === 'instagram' ? 'Instagram' : 'Facebook'} (at most ${CAPTION_MAX[ch]} characters).`
  }
  if (p.media.length > 10) return 'At most 10 pictures or videos in one post.'
  const videos = p.media.filter((m) => m.kind === 'video').length
  if (p.channels.includes('instagram')) {
    if (p.media.length === 0) return 'Instagram posts need a picture or a video.'
    if ((p.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) return 'Instagram allows at most 30 hashtags.'
    if (p.media.some((m) => m.kind === 'image' && !/\.jpe?g$/i.test(m.link))) return 'Instagram accepts JPEG pictures only. Save the picture as .jpg.'
  }
  if (p.postType === 'reel' && (p.media.length !== 1 || videos !== 1)) return 'A reel is exactly one video.'
  if (p.postType === 'story') {
    if (p.media.length !== 1) return 'A story is exactly one picture or video.'
    if (p.channels.includes('facebook')) return 'Facebook Page stories cannot be posted from here. Untick Facebook for a story.'
  }
  if (p.postType === 'feed' && p.media.length > 1 && videos > 0 && p.channels.includes('facebook')) return 'Facebook posts with several items take pictures only.'
  if (p.channels.includes('facebook') && p.media.length === 0 && !p.caption.trim()) return 'Write something to post on Facebook.'
  return null
}

// ── Meta calls ─────────────────────────────────────────────────────────────

type MetaErr = { message?: string; code?: number; error_subcode?: number }

async function call(method: 'GET' | 'POST', url: string, token: string, body?: Record<string, string> | FormData): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const sep = url.includes('?') ? '&' : '?'
  const init: RequestInit = { method, cache: 'no-store' }
  if (body instanceof FormData) init.body = body
  else if (body) { init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; init.body = new URLSearchParams(body).toString() }
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`, init).catch(() => null)
  if (!res) return { ok: false, error: 'Could not reach Meta.' }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: MetaErr }
  if (!res.ok || data.error) {
    console.error('[social publish] Meta error:', res.status, data.error?.code, data.error?.error_subcode, data.error?.message)
    return { ok: false, error: explainMetaError(data.error, res.status) }
  }
  return { ok: true, data }
}

const idOf = (d: Record<string, unknown>, key = 'id'): string | null => (typeof d[key] === 'string' && META_ID.test(d[key] as string) ? (d[key] as string) : null)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const WAIT_MS = process.env.VITEST ? 0 : 5_000

/** Wait (up to ~2 minutes) for Meta to finish processing a container. */
async function containerReady(host: string, container: string, token: string): Promise<'ready' | 'pending' | string> {
  for (let i = 0; i < 24; i++) {
    const r = await call('GET', `${host}/${container}?fields=status_code`, token)
    if (!r.ok) return r.error
    const code = r.data.status_code
    if (code === 'FINISHED' || code === 'PUBLISHED') return 'ready'
    if (code === 'ERROR' || code === 'EXPIRED') return 'Meta could not process this video. Try a shorter MP4 (H.264).'
    await sleep(WAIT_MS)
  }
  return 'pending'
}

async function publishInstagram(post: PostRow, auth: InsightAuth, prior: ChannelResult | undefined): Promise<ChannelResult> {
  const host = graphHost('instagram', auth.token)
  const node = `${host}/${auth.nodeId}`
  const caption = post.caption ?? ''
  const urlFor = (m: PostMedia) => publicMediaUrl(post.account_id, m.link)

  let container = prior?.container && META_ID.test(prior.container) ? prior.container : null
  if (!container) {
    if (post.media.some((m) => !urlFor(m))) return { error: 'Publishing to Instagram needs this server on https (NEXT_PUBLIC_APP_URL).' }
    if (post.media.length > 1 && post.post_type === 'feed') {
      const children: string[] = []
      for (const m of post.media) {
        const r = await call('POST', `${node}/media`, auth.token, m.kind === 'video'
          ? { media_type: 'VIDEO', video_url: urlFor(m)!, is_carousel_item: 'true' }
          : { image_url: urlFor(m)!, is_carousel_item: 'true' })
        if (!r.ok) return { error: r.error }
        const id = idOf(r.data)
        if (!id) return { error: 'Meta did not accept one of the items.' }
        if (m.kind === 'video') {
          const st = await containerReady(host, id, auth.token)
          if (st !== 'ready') return { error: st === 'pending' ? 'Meta is still processing a video. It will be tried again.' : st }
        }
        children.push(id)
      }
      const r = await call('POST', `${node}/media`, auth.token, { media_type: 'CAROUSEL', children: children.join(','), caption })
      if (!r.ok) return { error: r.error }
      container = idOf(r.data)
    } else {
      const m = post.media[0]
      const fields: Record<string, string> = post.post_type === 'story'
        ? { media_type: 'STORIES', ...(m.kind === 'video' ? { video_url: urlFor(m)! } : { image_url: urlFor(m)! }) }
        : m.kind === 'video'
          ? { media_type: 'REELS', video_url: urlFor(m)!, caption }
          : { image_url: urlFor(m)!, caption }
      const r = await call('POST', `${node}/media`, auth.token, fields)
      if (!r.ok) return { error: r.error }
      container = idOf(r.data)
    }
    if (!container) return { error: 'Meta did not accept the post.' }
  }
  const st = await containerReady(host, container, auth.token)
  if (st === 'pending') return { container } // tried again on a later tick
  if (st !== 'ready') return { error: st }
  const r = await call('POST', `${node}/media_publish`, auth.token, { creation_id: container })
  if (!r.ok) return { error: r.error, container }
  const id = idOf(r.data)
  return id ? { id, at: new Date().toISOString() } : { error: 'Meta did not confirm the post.', container }
}

async function fileBlob(accountId: string, m: PostMedia): Promise<Blob> {
  const type = publishableType(m.link)
  if (!type) throw new Error('unsupported file')
  const bytes = await readFile(uploadPathFor(m.link, accountId))
  return new Blob([new Uint8Array(bytes)], { type: type.mime })
}

async function publishFacebook(post: PostRow, auth: InsightAuth): Promise<ChannelResult> {
  const page = `https://graph.facebook.com/${GRAPH_API_VERSION}/${auth.nodeId}`
  const caption = post.caption ?? ''
  try {
    if (post.media.length === 0) {
      const r = await call('POST', `${page}/feed`, auth.token, { message: caption })
      return r.ok ? { id: idOf(r.data) ?? undefined, at: new Date().toISOString() } : { error: r.error }
    }
    if (post.media.length === 1 && post.media[0].kind === 'video') {
      const form = new FormData()
      form.append('description', caption)
      form.append('source', await fileBlob(post.account_id, post.media[0]), 'video.mp4')
      const r = await call('POST', `https://graph-video.facebook.com/${GRAPH_API_VERSION}/${auth.nodeId}/videos`, auth.token, form)
      return r.ok ? { id: idOf(r.data) ?? undefined, at: new Date().toISOString() } : { error: r.error }
    }
    if (post.media.length === 1) {
      const form = new FormData()
      form.append('caption', caption)
      form.append('source', await fileBlob(post.account_id, post.media[0]), 'photo')
      const r = await call('POST', `${page}/photos`, auth.token, form)
      return r.ok ? { id: idOf(r.data, 'post_id') ?? idOf(r.data) ?? undefined, at: new Date().toISOString() } : { error: r.error }
    }
    // Several pictures: uploaded unpublished, then one post with all of them.
    const ids: string[] = []
    for (const m of post.media) {
      const form = new FormData()
      form.append('published', 'false')
      form.append('source', await fileBlob(post.account_id, m), 'photo')
      const r = await call('POST', `${page}/photos`, auth.token, form)
      if (!r.ok) return { error: r.error }
      const id = idOf(r.data)
      if (!id) return { error: 'Meta did not accept one of the pictures.' }
      ids.push(id)
    }
    const body: Record<string, string> = { message: caption }
    ids.forEach((id, i) => { body[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }) })
    const r = await call('POST', `${page}/feed`, auth.token, body)
    return r.ok ? { id: idOf(r.data) ?? undefined, at: new Date().toISOString() } : { error: r.error }
  } catch (err) {
    console.error('[social publish] facebook file problem:', err instanceof Error ? err.message : err)
    return { error: 'A picture or video for this post could not be read. Upload it again.' }
  }
}

/** Publish one claimed post on every channel not already done. */
export async function publishPost(post: PostRow): Promise<{ status: 'published' | 'partial' | 'failed' | 'publishing'; results: Record<string, ChannelResult> }> {
  const results: Record<string, ChannelResult> = { ...(post.results ?? {}) }
  for (const ch of post.channels) {
    if (ch !== 'instagram' && ch !== 'facebook') continue
    if (results[ch]?.id) continue // already out: never posted twice
    const auth = await insightAuth(post.account_id, ch)
    if (!auth) { results[ch] = { error: `${ch === 'instagram' ? 'Instagram' : 'The Facebook Page'} is not connected.` }; continue }
    results[ch] = ch === 'instagram' ? await publishInstagram(post, auth, results[ch]) : await publishFacebook(post, auth)
  }
  const chans = post.channels.filter((c) => c === 'instagram' || c === 'facebook')
  const done = chans.filter((c) => results[c]?.id).length
  const waiting = chans.some((c) => !results[c]?.id && results[c]?.container && !results[c]?.error)
  if (done === chans.length) return { status: 'published', results }
  if (waiting && post.attempts < MAX_ATTEMPTS) return { status: 'publishing', results }
  return { status: done > 0 ? 'partial' : 'failed', results }
}

// ── The minute job ─────────────────────────────────────────────────────────

/** Claim due posts (and stuck ones to retry) atomically. */
export async function claimDuePosts(limit = 5): Promise<PostRow[]> {
  const rows = await prisma.$queryRaw<PostRow[]>`
    UPDATE social_posts SET status = 'publishing', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM social_posts
      WHERE (status = 'scheduled' AND scheduled_at <= now())
         OR (status = 'publishing' AND locked_at < now() - interval '3 minutes' AND attempts < ${MAX_ATTEMPTS})
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id::text AS id, account_id::text AS account_id, channels, post_type, caption, media, results, attempts`.catch(() => [] as PostRow[])
  return rows
}

async function saveOutcome(post: PostRow, outcome: Awaited<ReturnType<typeof publishPost>>): Promise<void> {
  const published = outcome.status === 'published' || outcome.status === 'partial'
  await prisma.$executeRaw`
    UPDATE social_posts SET status = ${outcome.status}, results = ${JSON.stringify(outcome.results)}::jsonb,
      published_at = CASE WHEN ${published} THEN COALESCE(published_at, now()) ELSE published_at END,
      locked_at = CASE WHEN ${outcome.status} = 'publishing' THEN now() - interval '2 minutes' ELSE NULL END,
      updated_at = now()
    WHERE id = ${post.id}::uuid AND account_id = ${post.account_id}::uuid`.catch((e: unknown) => console.error('[social publish] could not save outcome:', e instanceof Error ? e.message : e))
}

export async function sweepScheduledPosts(): Promise<number> {
  await ensurePostsTable()
  const due = await claimDuePosts()
  for (const post of due) {
    const outcome = await publishPost(post).catch((err: unknown) => {
      console.error('[social publish] post failed:', post.id, err instanceof Error ? err.message : err)
      return { status: 'failed' as const, results: { ...(post.results ?? {}), error: { error: 'Publishing stopped with an error. Try again.' } } }
    })
    await saveOutcome(post, outcome)
  }
  return due.length
}
