import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Train now" embedded one chunk at a time (10 s timeout each), so a large
// knowledge base outlasted the HTTP request. It now embeds a few at a time:
// never more than 4 at once, and one failure still never stops the rest.

const h = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, failText: null as string | null, inserts: 0 }))

vi.mock('@google/generative-ai', () => ({
  TaskType: { RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT', RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        embedContent: async (req: { content: { parts: Array<{ text: string }> } }) => {
          h.inFlight++
          h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
          await new Promise((r) => setTimeout(r, 5))
          h.inFlight--
          if (req.content.parts[0].text.includes(h.failText ?? '\u0000')) throw new Error('too long')
          return { embedding: { values: [0.1, 0.2] } }
        },
      }
    }
  },
}))
vi.mock('./usage', () => ({ recordAiUsage: async () => {}, estimateTokensFromText: () => 1 }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => [],
    $executeRaw: async () => { h.inserts++; return 1 },
  },
}))

import { syncKnowledgeEmbeddings } from './embeddings'

const items = Array.from({ length: 12 }, (_, i) => ({ kind: 'chunk' as const, text: `chunk number ${i}`, contentHash: `h${i}` }))

beforeEach(() => { h.inFlight = 0; h.maxInFlight = 0; h.failText = null; h.inserts = 0 })

describe('syncKnowledgeEmbeddings', () => {
  it('embeds several at a time, never more than 4', async () => {
    const r = await syncKnowledgeEmbeddings({ aiConfigId: 'cfg', apiKey: 'k', items })
    expect(r.embedded).toBe(12)
    expect(h.maxInFlight).toBeGreaterThan(1)
    expect(h.maxInFlight).toBeLessThanOrEqual(4)
  })

  it('one failing chunk is counted and reported; the others are still saved', async () => {
    h.failText = 'chunk number 5'
    const r = await syncKnowledgeEmbeddings({ aiConfigId: 'cfg', apiKey: 'k', items })
    expect(r.failed).toBe(1)
    expect(r.embedded).toBe(11)
    expect(r.firstError).toMatch(/too long/)
  })
})
