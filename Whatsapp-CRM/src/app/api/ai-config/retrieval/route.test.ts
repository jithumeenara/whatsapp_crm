import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The re-rank switch: admins only, a real boolean, own workspace, audited. */

const h = vi.hoisted(() => ({ role: 'admin', saved: [] as Array<{ account: string; rerank: boolean }>, audits: 0 }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (h.role === 'agent') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { userId: 'u1', accountId: 'acc-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => { h.audits += 1 } }))
vi.mock('@/lib/ai/providers/registry', () => ({ getProviderKeys: () => ({ gemini: { api_key: 'enc' } }) }))
vi.mock('@/lib/ai/retrieval-settings', () => ({
  retrievalSettingsFor: async () => ({ rerank: h.saved.at(-1)?.rerank ?? false }),
  setRetrievalSettings: async (account: string, s: { rerank: boolean }) => { h.saved.push({ account, rerank: s.rerank }) },
}))
vi.mock('@/lib/db', () => ({
  prisma: { aiConfig: { findUnique: async () => ({ id: 'cfg', provider_keys: {}, retrieval_mode: 'semantic' }) } },
}))

import { GET, PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }))
beforeEach(() => { h.role = 'admin'; h.saved = []; h.audits = 0 })

describe('/api/ai-config/retrieval', () => {
  it('an agent cannot change it', async () => {
    h.role = 'agent'
    expect((await put({ rerank: true })).status).toBe(403)
    expect(h.saved).toHaveLength(0)
  })

  it('only a real true/false is accepted', async () => {
    for (const bad of ['yes', 1, null, undefined]) expect((await put({ rerank: bad })).status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it("saves to the caller's workspace and audits it", async () => {
    const res = await put({ rerank: true, account_id: 'other' })
    expect(res.status).toBe(200)
    expect(h.saved).toEqual([{ account: 'acc-1', rerank: true }])
    expect(h.audits).toBe(1)
    expect(await (await GET()).json()).toMatchObject({ rerank: true, ready: true })
  })
})
