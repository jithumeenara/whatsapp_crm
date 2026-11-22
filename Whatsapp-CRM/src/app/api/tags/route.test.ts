import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Creating a tag (POST /api/tags).
 *  - Bug: the colour was stored as any text, and several screens put it into
 *    CSS as-is (`style={{ background: t.color }}`), so a colour like
 *    url(https://evil.example/x) made every staff browser that showed the
 *    tag contact an outside server. Only #rrggbb is stored now.
 *  - Bug: the name was not checked (an object crashed the route; any length
 *    was stored) and the same name could be created twice.
 */

const h = vi.hoisted(() => ({ role: 'agent', tags: [] as Array<Record<string, unknown>>, created: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'u1', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    tag: {
      findMany: async () => h.tags,
      findFirst: async ({ where }: { where: { account_id: string; name: { equals: string } } }) =>
        h.tags.find((t) => t.account_id === where.account_id && String(t.name).toLowerCase() === where.name.equals.toLowerCase()) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const t = { id: `t${h.created.length + 1}`, ...data }; h.created.push(t); h.tags.push(t); return t },
    },
  },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/tags', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { h.role = 'agent'; h.tags = []; h.created = [] })

describe('creating a tag', () => {
  it('a normal tag is saved with its colour', async () => {
    const res = await post({ name: '  Hot lead ', color: '#ef4444' })
    expect(res.status).toBe(201)
    expect(h.created[0]).toMatchObject({ account_id: 'acc', name: 'Hot lead', color: '#ef4444' })
  })

  it('a colour that is not #rrggbb is never stored (no CSS from users)', async () => {
    for (const color of ['url(https://evil.example/x)', 'red;background:url(//e.x)', 'expression(alert(1))', 123]) {
      h.tags = []; h.created = []
      await post({ name: `tag ${String(color).slice(0, 5)}`, color })
      expect(h.created[0]?.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('a name that is not text, empty, or too long is refused', async () => {
    expect((await post({ name: { $gt: '' } })).status).toBe(400)
    expect((await post({ name: '   ' })).status).toBe(400)
    expect((await post({ name: 'x'.repeat(41) })).status).toBe(400)
    expect(h.created).toHaveLength(0)
  })

  it('the same name again (any case) returns the existing tag instead of a duplicate', async () => {
    await post({ name: 'Fees' })
    const again = await post({ name: 'fees' })
    expect(again.status).toBe(200)
    expect((await again.json()).tag.id).toBe('t1')
    expect(h.created).toHaveLength(1)
  })

  it('a viewer cannot create tags', async () => {
    h.role = 'viewer'
    expect((await post({ name: 'x' })).status).toBe(403)
  })
})
