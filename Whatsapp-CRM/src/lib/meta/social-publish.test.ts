import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Publishing: Meta's rules checked before anything is sent; a channel that
 * already published is never published again on a retry; Instagram goes
 * container → publish with a signed link; a still-processing video waits for
 * the next tick instead of failing; plain words on failure.
 */

const ACC = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({ calls: [] as Array<{ url: string; method: string; body: string }>, status: 'FINISHED', fail: '' }))

vi.mock('@/lib/meta/social-insights', () => ({
  insightAuth: async (_a: string, ch: string) => ({ token: ch === 'instagram' ? 'EAAig' : 'EAApage', nodeId: ch === 'instagram' ? '17841400000000' : '1029' }),
}))
vi.mock('@/lib/whatsapp/media-ref', () => ({ uploadPathFor: () => '/tmp/x.jpg' }))
vi.mock('fs/promises', () => ({ readFile: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: async () => [], $executeRaw: async () => 1 } }))

import { postProblem, publishPost, type PostRow } from './social-publish'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-publish'; process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example' })
beforeEach(() => {
  h.calls = []; h.status = 'FINISHED'; h.fail = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const u = String(url)
    h.calls.push({ url: u, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : '' })
    if (h.fail && u.includes(h.fail)) return new Response(JSON.stringify({ error: { code: 9004, message: 'raw meta words fbtrace_id=Q' } }), { status: 400 })
    if (u.includes('fields=status_code')) return new Response(JSON.stringify({ status_code: h.status }), { status: 200 })
    if (u.includes('/media_publish')) return new Response(JSON.stringify({ id: '17999000000000001' }), { status: 200 })
    if (u.includes('/media')) return new Response(JSON.stringify({ id: '17888000000000001' }), { status: 200 })
    return new Response(JSON.stringify({ id: '1029_555', post_id: '1029_555' }), { status: 200 })
  }))
})

const post = (over: Partial<PostRow> = {}): PostRow => ({
  id: 'p1', account_id: ACC, channels: ['instagram'], post_type: 'feed', caption: 'Admissions open', attempts: 1,
  media: [{ link: `/api/files/account-${ACC}/a.jpg`, kind: 'image' }], results: {}, ...over,
})

describe("Meta's rules, before anything is sent", () => {
  const img = { link: '/x/a.jpg', kind: 'image' as const }
  const vid = { link: '/x/a.mp4', kind: 'video' as const }
  it.each([
    [{ channels: [], postType: 'feed', caption: 'x', media: [img] }, /Choose/],
    [{ channels: ['instagram'], postType: 'feed', caption: 'x', media: [] }, /need a picture/],
    [{ channels: ['instagram'], postType: 'feed', caption: 'x', media: [{ link: '/x/a.png', kind: 'image' }] }, /JPEG/],
    [{ channels: ['instagram'], postType: 'reel', caption: 'x', media: [img] }, /reel is exactly one video/],
    [{ channels: ['facebook'], postType: 'story', caption: 'x', media: [img] }, /stories cannot/],
    [{ channels: ['instagram'], postType: 'feed', caption: 'x'.repeat(2201), media: [img] }, /too long/],
    [{ channels: ['instagram'], postType: 'feed', caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), media: [img] }, /30 hashtags/],
    [{ channels: ['facebook'], postType: 'feed', caption: 'x', media: [img, vid] }, /pictures only/],
  ])('refuses %#', (p, msg) => {
    expect(postProblem(p as Parameters<typeof postProblem>[0])).toMatch(msg)
  })
  it('accepts a normal Instagram picture post and a Facebook text post', () => {
    expect(postProblem({ channels: ['instagram'], postType: 'feed', caption: 'hi', media: [img] })).toBeNull()
    expect(postProblem({ channels: ['facebook'], postType: 'feed', caption: 'hi', media: [] })).toBeNull()
  })
})

describe('publishing', () => {
  it('Instagram: container with a signed https link, then publish', async () => {
    const r = await publishPost(post())
    expect(r.status).toBe('published')
    expect(r.results.instagram.id).toBe('17999000000000001')
    const create = h.calls.find((c) => c.url.includes('/17841400000000/media?'))!
    expect(decodeURIComponent(create.body)).toMatch(/image_url=https:\/\/crm\.example\/api\/social\/media\//)
    expect(h.calls.some((c) => c.url.includes('/media_publish'))).toBe(true)
  })
  it('a channel that already published is never published again on a retry', async () => {
    const r = await publishPost(post({ channels: ['instagram', 'facebook'], results: { instagram: { id: '17999000000000009' } } }))
    expect(h.calls.some((c) => c.url.includes('17841400000000'))).toBe(false)
    expect(r.results.instagram.id).toBe('17999000000000009')
    expect(r.status).toBe('published')
  })
  it('a video still processing: kept for the next tick, not failed', async () => {
    h.status = 'IN_PROGRESS'
    const r = await publishPost(post({ post_type: 'reel', media: [{ link: `/api/files/account-${ACC}/a.mp4`, kind: 'video' }] }))
    expect(r.status).toBe('publishing')
    expect(r.results.instagram.container).toBe('17888000000000001')
    expect(h.calls.some((c) => c.url.includes('/media_publish'))).toBe(false)
  })
  it('Meta refuses: failed with plain words, no raw Meta text', async () => {
    h.fail = '/media?'
    const r = await publishPost(post())
    expect(r.status).toBe('failed')
    expect(r.results.instagram.error).not.toMatch(/fbtrace|raw meta/)
  })
  it('Facebook picture: uploaded to the Page directly (no public link)', async () => {
    const r = await publishPost(post({ channels: ['facebook'] }))
    expect(r.status).toBe('published')
    expect(h.calls[0].url.startsWith('https://graph.facebook.com/v27.0/1029/photos?')).toBe(true)
    expect(h.calls.some((c) => c.url.includes('/api/social/media/'))).toBe(false)
  })
})
