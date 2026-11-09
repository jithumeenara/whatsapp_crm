import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/profile: a member's own display name.
 *
 * Found in security review: any member could set their name to thousands of
 * characters, which later froze the PDF build for minutes. The name is cleaned
 * and capped when it is saved.
 */

const h = vi.hoisted(() => ({ updates: [] as Array<Record<string, any>> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'agent' }),
  toErrorResponse: (e: any) => Response.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      update: ({ data }: any) => {
        h.updates.push(data)
        return Promise.resolve({ id: 'p1', full_name: data.full_name ?? 'x', email: 'a@b.c' })
      },
    },
  },
}))

import { PATCH } from './route'

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://x/api/profile', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  h.updates = []
})

describe('PATCH /api/profile: full_name', () => {
  it('caps a name of thousands of characters', async () => {
    const res = await patch({ full_name: 'ആശ Kumar '.repeat(1000) })
    expect(res.status).toBe(200)
    expect(Array.from(h.updates[0].full_name as string).length).toBeLessThanOrEqual(100)
  })

  it('strips control characters and bidi overrides, and keeps an ordinary name as it is', async () => {
    await patch({ full_name: 'As\u0000ha \u202EKumar' })
    expect(h.updates[0].full_name).toBe('Asha Kumar')
    await patch({ full_name: 'ആശ ടീച്ചർ' })
    expect(h.updates[1].full_name).toBe('ആശ ടീച്ചർ')
  })

  it('still refuses a name that is empty once cleaned', async () => {
    expect((await patch({ full_name: '\u0000\n  ' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
