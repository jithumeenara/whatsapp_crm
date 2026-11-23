import { describe, expect, it, vi } from 'vitest'

/**
 * Re-ranking: the model's order is used when it is clean, ignored when it
 * is not, and the search still works when the model fails.
 */

const semanticHits: string[] = []
vi.mock('./embeddings', async () => {
  const actual = await vi.importActual<typeof import('./embeddings')>('./embeddings')
  return {
    ...actual,
    hasEmbeddings: async () => true,
    embedQuery: async () => [0],
    findSimilarKnowledge: async () =>
      semanticHits.map((hash, i) => ({ contentHash: hash, kind: 'chunk' as const, similarity: 0.8 - i * 0.05 })),
  }
})

import { applyOrder, cleanOrder } from './rerank'
import { selectRelevantContext } from './knowledge'
import { chunkContentHash } from './embeddings'

describe('cleanOrder', () => {
  it('keeps valid unique indices and appends the ones the model left out', () => {
    expect(cleanOrder({ order: [2, 2, 9, 'x', 0] }, 4)).toEqual([2, 0, 1, 3])
  })
  it('an unusable answer keeps the search order', () => {
    expect(cleanOrder(null, 3)).toBeNull()
    expect(cleanOrder({ order: [] }, 3)).toBeNull()
    expect(cleanOrder({ nope: 1 }, 3)).toBeNull()
  })
  it('applyOrder puts items in the given order', () => {
    expect(applyOrder(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b'])
    expect(applyOrder(['a', 'b'], null)).toEqual(['a', 'b'])
  })
})

describe('re-ranking inside the search', () => {
  const docs = [
    { id: 'p1', title: 'Product refunds', content: 'Products can be returned within 7 days.' },
    { id: 'p2', title: 'Service refunds', content: 'Services are refunded only before the appointment.' },
    { id: 'p3', title: 'Hours', content: 'Open 9 to 5.' },
  ]
  const hashes = docs.map((d) => chunkContentHash({ title: d.title, text: d.content }))

  it('the model can move the passage that answers the question to the top', async () => {
    semanticHits.splice(0, semanticHits.length, ...hashes)
    const rerank = vi.fn(async (_q: string, texts: string[]) => [texts.findIndex((t) => t.startsWith('Service refunds'))])
    const selected = await selectRelevantContext('can I get my money back for a service', [], docs, {
      maxDocChunks: 1,
      semantic: { aiConfigId: 'cfg', geminiApiKey: 'key' },
      rerank,
    })
    expect(rerank).toHaveBeenCalledOnce()
    expect(selected.documentChunks[0].sourceId).toBe('p2')
  })

  it('when the model fails, the result is exactly what the search alone gives', async () => {
    semanticHits.splice(0, semanticHits.length, ...hashes)
    const base = { maxDocChunks: 1, semantic: { aiConfigId: 'cfg', geminiApiKey: 'key' } }
    const without = await selectRelevantContext('refund', [], docs, base)
    const failed = await selectRelevantContext('refund', [], docs, { ...base, rerank: async () => null })
    expect(failed.documentChunks.map((c) => c.sourceId)).toEqual(without.documentChunks.map((c) => c.sourceId))
  })
})
