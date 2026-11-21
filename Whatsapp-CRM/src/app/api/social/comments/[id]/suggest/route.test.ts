import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AI suggestion for a comment: never sends anything; a PUBLIC reply is drafted
 * without the commenter's contact, so no personal detail can be looked up and
 * written under a public post; only this workspace's comment; agent+.
 */

const ID = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({
  role: 'agent',
  row: { channel: 'instagram', text: 'Is my registration confirmed?', contact_id: 'contact-1', post_caption: 'Admissions' } as Record<string, unknown> | null,
  turns: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (_p: string, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc-1', userId: 'u-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { aiCall: {} } }))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: async () => {} }))
vi.mock('@/lib/ai/providers/registry', () => ({ getProviderKeys: () => ({}) }))
vi.mock('@/lib/jobs/public-error', () => ({ publicErrorMessage: (_e: unknown, f: string) => f }))
vi.mock('@/lib/ai/customer-pipeline', () => ({
  runCustomerTurn: async (a: Record<string, unknown>) => { h.turns.push(a); return { reply: 'Please check your messages.', effectiveConfidence: 0.9, decision: { action: 'reply' } } },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => (h.row && values.includes('acc-1') ? [h.row] : []),
    aiConfig: { findUnique: async () => ({ system_prompt: 'You help.', confidence_threshold: 0.5, active_provider: 'gemini' }) },
  },
}))

import { POST } from './route'

const call = (mode: string) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ mode }) }), { params: Promise.resolve({ id: ID }) })

beforeEach(() => { h.role = 'agent'; h.turns = []; h.row = { channel: 'instagram', text: 'Is my registration confirmed?', contact_id: 'contact-1', post_caption: 'Admissions' } })

describe('comment reply suggestion', () => {
  it('public: drafted as a stranger (no contact), no side effects, told it is public', async () => {
    const res = await call('public')
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toBe('Please check your messages.')
    expect(h.turns[0]).toMatchObject({ contactId: null, noSideEffects: true, conversationHistory: [] })
    expect(String((h.turns[0].aiConfig as { system_prompt: string }).system_prompt)).toMatch(/PUBLICLY/)
  })
  it('private: the known contact may be used, still no side effects', async () => {
    await call('private')
    expect(h.turns[0]).toMatchObject({ contactId: 'contact-1', noSideEffects: true })
  })
  it("another workspace's comment, or a bad id: not found, no model call", async () => {
    h.row = null
    expect((await call('public')).status).toBe(404)
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: 'x; drop' }) })).status).toBe(404)
    expect(h.turns).toHaveLength(0)
  })
  it('a viewer cannot spend AI calls', async () => {
    h.role = 'viewer'
    expect((await call('public')).status).toBe(403)
    expect(h.turns).toHaveLength(0)
  })
})
