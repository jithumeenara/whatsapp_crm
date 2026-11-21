import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/audit/actors', () => ({ withJobAudit: async (_n: string, fn: () => unknown) => fn() }))

import { fairPick } from './knowledge-sweep'

// Bug: one pass re-read at most 20 entries across ALL accounts, oldest
// first, so a single business with a big backlog of sheets delayed every
// other business's refresh. Now each account gets a share of the pass.

describe('fairPick', () => {
  it('caps one account so another still gets refreshed in the same pass', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, account: 'A' })),
      { id: 'b0', account: 'B' },
      { id: 'b1', account: 'B' },
    ]
    const picked = fairPick(rows, (r) => r.account, 10, 60)
    expect(picked.filter((r) => r.account === 'A')).toHaveLength(10)
    expect(picked.filter((r) => r.account === 'B').map((r) => r.id)).toEqual(['b0', 'b1'])
  })

  it('keeps the oldest-first order and the overall limit', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, account: `acc${i % 20}` }))
    const picked = fairPick(rows, (r) => r.account, 10, 60)
    expect(picked).toHaveLength(60)
    expect(picked.map((r) => r.id).slice(0, 3)).toEqual(['0', '1', '2'])
  })
})
