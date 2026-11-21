import { beforeEach, describe, expect, it, vi } from 'vitest'

// Bug: after any training run with no embedding failures, EVERY entry in
// 'pending' or 'failed' was set to 'trained' and its last_error cleared.
// That hid a Google Sheet / website whose re-sync had failed (it showed
// "Trained" with a stale copy), an entry edited while the run was going,
// and an entry with a future start date (left out of the run, so it has
// no vector at all). Only what this run actually embedded may be marked.

const h = vi.hoisted(() => ({
  updateWhere: [] as Array<Record<string, unknown>>,
  failed: 0,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    aiConfig: { findUnique: async () => ({ id: 'cfg', account_id: 'acc', provider_keys: {}, knowledge_base_enabled: true }) },
    aiKnowledgeItem: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => { h.updateWhere.push(where); return { count: 2 } },
    },
  },
}))
vi.mock('./providers/registry', () => ({ geminiCredentials: () => ({ apiKey: 'k' }) }))
vi.mock('./knowledge-store', () => ({
  loadKnowledge: async () => ({
    qaPairs: [{ id: 'Q1', question: 'q', answer: 'a' }],
    documents: [{ id: 'D1', title: 'Fees', content: 'Fee 10,400' }],
    tables: [],
    version: 'v',
  }),
}))
vi.mock('./knowledge', () => ({ chunkDocument: (d: { id: string }) => [{ ...d, chunk: 0 }] }))
vi.mock('./embeddings', () => ({
  toKnowledgeItems: (q: unknown[], c: unknown[]) => [...q, ...c],
  syncKnowledgeEmbeddings: async () => ({ embedded: 2, failed: h.failed, firstError: h.failed ? 'quota' : null }),
}))

import { trainKnowledgeConfig } from './train-pending'

beforeEach(() => { h.updateWhere = []; h.failed = 0 })

describe('trainKnowledgeConfig marks only what it embedded', () => {
  it('marks trained only the entries in this run, only from pending, only if not edited since it started', async () => {
    const before = Date.now()
    const r = await trainKnowledgeConfig('cfg')
    expect(r.trained).toBe(2)
    const where = h.updateWhere[0]
    expect(where).toMatchObject({ ai_config_id: 'cfg', id: { in: ['Q1', 'D1'] }, status: 'pending' })
    const lte = (where.updated_at as { lte: Date }).lte
    expect(lte).toBeInstanceOf(Date)
    expect(lte.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('never turns a failed re-sync into "trained"', async () => {
    await trainKnowledgeConfig('cfg')
    expect(JSON.stringify(h.updateWhere[0].status)).not.toContain('failed')
  })

  it('a run with embedding failures marks nothing', async () => {
    h.failed = 1
    const r = await trainKnowledgeConfig('cfg')
    expect(r.trained).toBe(0)
    expect(h.updateWhere).toHaveLength(0)
  })
})
