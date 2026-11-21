import { beforeEach, describe, expect, it, vi } from 'vitest'

// Editing a knowledge entry's text (bug: Text/Notes content could not be
// edited). The server rules behind the edit box:
//  - text/document content is the app's own copy: trimmed, capped, saved,
//    and the entry goes back to "pending" so it is trained again;
//  - website / sheet / table / chatbot content belongs to its source and
//    is replaced on every re-sync, so an edit is refused instead of being
//    silently overwritten later.

const h = vi.hoisted(() => ({
  existing: { id: 'K1', account_id: 'acc', ai_config_id: 'cfg', kind: 'text', name: 'Fees', description: null, status: 'trained', source_url: null, source_ref: null } as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'admin' }),
  toErrorResponse: (e: unknown) => { throw e },
}))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/ai/knowledge-refresh', () => ({ scheduleKnowledgeRefresh: () => {} }))
vi.mock('@/lib/ai/knowledge-store', () => ({ invalidateKnowledge: () => {} }))
vi.mock('@/lib/ai/web-extract', () => ({ fetchPageText: async () => '' }))
vi.mock('@/lib/ai/providers/registry', () => ({ geminiCredentials: () => null }))
vi.mock('@/lib/ai/google-sheet', () => ({ fetchSheetForAccount: async () => ({}), serializeSheet: () => '' }))
vi.mock('@/lib/ai/data-store-source', () => ({ serializeDataTable: async () => ({ text: '' }) }))
vi.mock('@/lib/ai/chatbot-source', () => ({ serializeChatbot: async () => ({ text: '' }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    aiKnowledgeItem: {
      findFirst: async ({ where }: { where: { id: string; account_id: string } }) =>
        where.account_id === 'acc' && where.id === 'K1' ? h.existing : null,
      update: async ({ data }: { data: Record<string, unknown> }) => { h.updates.push(data); return { ...h.existing, ...data } },
    },
  },
}))

import { PATCH } from './route'

const patch = (body: unknown, id = 'K1') =>
  PATCH(new Request(`http://x/api/ai-knowledge/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  h.existing = { ...h.existing, kind: 'text', status: 'trained' }
  h.updates = []
})

describe('PATCH /api/ai-knowledge/[id] content', () => {
  it('saves edited text, trimmed, and sends the entry back to be trained', async () => {
    const res = await patch({ content: '  New fee: 10,400\n\n' })
    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ content: 'New fee: 10,400', status: 'pending' })
  })

  it('a document entry is the app’s own copy too', async () => {
    h.existing = { ...h.existing, kind: 'document' }
    expect((await patch({ content: 'Corrected text' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ content: 'Corrected text' })
  })

  it.each(['website', 'sheet', 'database', 'chatbot'])('refuses a content edit on a %s entry (its source would overwrite it)', async (kind) => {
    h.existing = { ...h.existing, kind }
    const res = await patch({ content: 'typed over' })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('refuses empty text and text over 200,000 characters, with a clear message', async () => {
    const empty = await patch({ content: '   ' })
    expect(empty.status).toBe(400)
    const long = await patch({ content: 'x'.repeat(200_001) })
    expect(long.status).toBe(400)
    expect((await long.json()).error).toMatch(/200,000/)
    expect(h.updates).toHaveLength(0)
  })

  it('another account’s entry is not found', async () => {
    expect((await patch({ content: 'x' }, 'other')).status).toBe(404)
  })
})
