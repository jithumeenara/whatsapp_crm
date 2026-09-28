import { describe, it, expect, vi } from 'vitest'

// The search by meaning, simulated: it "finds" whatever the test says,
// by content hash, the way the vector search answers.
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

import { reciprocalRankFusion, selectRelevantContext } from './knowledge'
import { chunkContentHash } from './embeddings'

describe('reciprocal rank fusion', () => {
  it('puts what both lists found first, then by rank, ties to the first list', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'x']], (s) => s)
    expect(fused).toEqual(['c', 'a', 'b', 'x'])
  })
})

describe('hybrid search', () => {
  const docs = [
    { id: 'fees', title: 'Fees', content: 'Fee details for every programme are on the Training page.' },
    { id: 'hostel', title: 'Hostel', content: 'Hostel rooms are available on the campus.' },
    { id: 'stpm', title: 'STP (M)', content: 'Programme code STP-M-2026 runs 12 to 16 October for the Ministerial Cadre.' },
  ]

  it('adds the exact match the search by meaning missed', async () => {
    // Meaning found the two general passages, not the one with the code.
    semanticHits.splice(0, semanticHits.length, chunkContentHash({ title: 'Fees', text: docs[0].content }), chunkContentHash({ title: 'Hostel', text: docs[1].content }))
    const selected = await selectRelevantContext('STP-M-2026 dates', [], docs, {
      maxDocChunks: 2,
      semantic: { aiConfigId: 'cfg', geminiApiKey: 'key' },
    })
    expect(selected.documentChunks.map((c) => c.sourceId)).toContain('stpm')
    // The meaning score still decides confidence.
    expect(selected.confidence).toBeCloseTo(0.8)
  })

  it('leaves the meaning results alone when no strong word match exists', async () => {
    semanticHits.splice(0, semanticHits.length, chunkContentHash({ title: 'Hostel', text: docs[1].content }))
    const selected = await selectRelevantContext('where can I stay overnight', [], docs, {
      maxDocChunks: 2,
      semantic: { aiConfigId: 'cfg', geminiApiKey: 'key' },
    })
    expect(selected.documentChunks.map((c) => c.sourceId)).toEqual(['hostel'])
  })
})
