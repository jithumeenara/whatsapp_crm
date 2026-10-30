/**
 * N6 (security review 2026-10): POST /api/messages/ai-suggest let any member
 * (a viewer) spend AI credits, and let an agent draft from — and so read a
 * summary of — a conversation assigned to a colleague. It now needs agent
 * rank, and an agent sees only conversations assigned to them, the same
 * rule as /api/conversations and /api/conversations/[id].
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ role: 'agent' as string, aiConfigReads: 0 }))

const CONVS = [
  { id: 'mine', account_id: 'a1', assigned_agent_id: 'u1' },
  { id: 'colleague', account_id: 'a1', assigned_agent_id: 'u2' },
  { id: 'unassigned', account_id: 'a1', assigned_agent_id: null },
  { id: 'other-tenant', account_id: 'a2', assigned_agent_id: 'u1' },
]

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  const ctx = async (min: Parameters<typeof hasMinRole>[1]) => {
    if (!hasMinRole(h.role as Parameters<typeof hasMinRole>[0], min)) throw new actual.ForbiddenError('forbidden')
    return { accountId: 'a1', userId: 'u1', role: h.role, pageAccess: null }
  }
  return { ...actual, requireRole: ctx, getCurrentAccount: () => ctx('viewer') }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        CONVS.find((c) => Object.entries(where).every(([k, v]) => (c as Record<string, unknown>)[k] === v)) ?? null,
    },
    // Stop right after the access decision: no AI config → 400.
    aiConfig: {
      findUnique: async () => {
        h.aiConfigReads++
        return null
      },
    },
  },
}))

import { POST } from './route'

const call = (conversation_id: string) =>
  POST(new Request('http://x/api/messages/ai-suggest', { method: 'POST', body: JSON.stringify({ conversation_id }) }))

beforeEach(() => {
  h.aiConfigReads = 0
})

describe('ai-suggest — who may draft from which conversation', () => {
  it('a viewer is refused (403) before anything is read', async () => {
    h.role = 'viewer'
    expect((await call('mine')).status).toBe(403)
    expect(h.aiConfigReads).toBe(0)
  })
  it('an agent may draft from a conversation assigned to them', async () => {
    h.role = 'agent'
    expect((await call('mine')).status).toBe(400) // reached the AI config step
    expect(h.aiConfigReads).toBe(1)
  })
  for (const id of ['colleague', 'unassigned']) {
    it(`an agent cannot draft from a ${id} conversation (404)`, async () => {
      h.role = 'agent'
      expect((await call(id)).status).toBe(404)
      expect(h.aiConfigReads).toBe(0)
    })
  }
  it('a supervisor may draft from any conversation in the account', async () => {
    h.role = 'supervisor'
    expect((await call('colleague')).status).toBe(400)
    expect((await call('unassigned')).status).toBe(400)
  })
  it('nobody reaches another account’s conversation', async () => {
    h.role = 'owner'
    expect((await call('other-tenant')).status).toBe(404)
  })
})
