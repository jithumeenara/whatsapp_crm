import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Creating a post: supervisor+; media must be this workspace's own real
 * uploads; a double-clicked Publish is one post (client_key); times in the
 * past or too far ahead refused; cancel only while waiting.
 */

const ACC = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({ role: 'supervisor', inserts: [] as unknown[][], keys: new Set<string>(), bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), cancelRows: 1, sweeps: 0 }))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (_p: string, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: ACC, userId: '99999999-2222-4333-8444-555555555555', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { apiWrite: {} } }))
vi.mock('fs/promises', () => ({ stat: async () => ({ isFile: () => true, size: 1000 }), readFile: async () => h.bytes }))
vi.mock('@/lib/whatsapp/media-ref', () => ({
  uploadPathFor: (link: string, accountId: string) => { if (!link.startsWith(`/api/files/account-${accountId}/`)) throw new Error('not yours'); return '/u/x' },
}))
vi.mock('@/lib/meta/social-insights', () => ({ insightAuth: async () => ({ token: 'EAA', nodeId: '1' }) }))
vi.mock('@/lib/meta/social-publish', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/social-publish')>('@/lib/meta/social-publish')
  return { ...actual, ensurePostsTable: async () => {}, sweepScheduledPosts: async () => { h.sweeps++; return 0 } }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('INSERT INTO social_posts')) {
        const key = String(values[2]); const created = !h.keys.has(key); h.keys.add(key); h.inserts.push(values)
        return [{ id: 'post-1', created }]
      }
      return []
    },
    $executeRaw: async () => h.cancelRows,
  },
}))

import { POST } from './route'
import { DELETE } from './[id]/route'

const body = (over: Record<string, unknown> = {}) => ({ client_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', channels: ['instagram'], post_type: 'feed', caption: 'Admissions open', media: [`/api/files/account-${ACC}/a.jpg`], ...over })
const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }))

beforeEach(() => { h.role = 'supervisor'; h.inserts = []; h.keys = new Set(); h.bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); h.cancelRows = 1; h.sweeps = 0 })

describe('creating a post', () => {
  it('publish now: saved once and sent at once; a double click is the same post', async () => {
    expect((await post(body())).status).toBe(200)
    const again = await (await post(body())).json()
    expect(again.duplicate).toBe(true)
    expect(h.sweeps).toBe(2)
  })
  it('an agent cannot post as the business', async () => {
    h.role = 'agent'
    expect((await post(body())).status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })
  it("another workspace's file, a fake picture, or an odd type is refused", async () => {
    expect((await post(body({ media: ['/api/files/account-99999999-2222-4333-8444-555555555555/a.jpg'] }))).status).toBe(400)
    expect((await post(body({ media: [`/api/files/account-${ACC}/a.svg`] }))).status).toBe(400)
    h.bytes = Buffer.from('<html>')
    expect((await post(body())).status).toBe(400)
    expect(h.inserts).toHaveLength(0)
  })
  it('bad fields are refused: unknown channel, object caption, past or far-future time', async () => {
    expect((await post(body({ channels: ['instagram', 'tiktok'] }))).status).toBe(400)
    expect((await post(body({ caption: { $x: 1 } }))).status).toBe(400)
    expect((await post(body({ scheduled_at: new Date(Date.now() - 3_600_000).toISOString() }))).status).toBe(400)
    expect((await post(body({ scheduled_at: new Date(Date.now() + 80 * 86_400_000).toISOString() }))).status).toBe(400)
    expect((await post(body({ client_key: 'x' }))).status).toBe(400)
    expect(h.inserts).toHaveLength(0)
  })
  it('a scheduled post is saved and waits for its time', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString()
    expect((await post(body({ scheduled_at: at }))).status).toBe(200)
    expect(h.sweeps).toBe(0)
  })
})

describe('cancelling', () => {
  const del = (id: string) => DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id }) })
  it('only a waiting post; a bad id is not found', async () => {
    expect((await del('11111111-2222-4333-8444-555555555555')).status).toBe(200)
    h.cancelRows = 0
    expect((await del('11111111-2222-4333-8444-555555555555')).status).toBe(409)
    expect((await del("1' OR 1=1")).status).toBe(404)
  })
})
