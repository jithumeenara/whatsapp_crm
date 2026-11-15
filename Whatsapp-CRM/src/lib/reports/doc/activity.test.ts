import { describe, expect, it } from 'vitest'
import { firstCallBuckets, followUpStats, idleBucket, median, onTimePct, FOLLOW_UP_GRACE_MS } from './activity'

const now = new Date('2026-11-15T12:00:00Z')
const t = (iso: string) => new Date(iso)

describe('followUpStats', () => {
  it('done before due (or within the grace) is on time; after it is late', () => {
    const s = followUpStats([
      { due_at: t('2026-11-14T10:00:00Z'), status: 'done', completed_at: t('2026-11-14T09:00:00Z') },
      { due_at: t('2026-11-14T10:00:00Z'), status: 'done', completed_at: new Date(t('2026-11-14T10:00:00Z').getTime() + FOLLOW_UP_GRACE_MS) },
      { due_at: t('2026-11-14T10:00:00Z'), status: 'done', completed_at: t('2026-11-14T18:00:00Z') },
    ], now)
    expect(s).toMatchObject({ due: 3, onTime: 2, late: 1, missed: 0, skipped: 0 })
  })

  it('still pending past due is missed; skipped is counted apart', () => {
    const s = followUpStats([
      { due_at: t('2026-11-14T10:00:00Z'), status: 'pending', completed_at: null },
      { due_at: t('2026-11-14T10:00:00Z'), status: 'skipped', completed_at: null },
    ], now)
    expect(s).toMatchObject({ due: 2, onTime: 0, late: 0, missed: 1, skipped: 1 })
  })

  it('a follow-up not yet due is not counted at all', () => {
    const s = followUpStats([{ due_at: t('2026-11-16T10:00:00Z'), status: 'pending', completed_at: null }], now)
    expect(s.due).toBe(0)
  })

  it('done with no completion time is on time rather than a false "late"', () => {
    const s = followUpStats([{ due_at: t('2026-11-14T10:00:00Z'), status: 'done', completed_at: null }], now)
    expect(s).toMatchObject({ due: 1, onTime: 1 })
  })
})

describe('onTimePct', () => {
  it('skipped ones are left out of the share; nothing due is unknown, never 0%', () => {
    expect(onTimePct({ due: 4, onTime: 2, late: 1, missed: 0, skipped: 1 })).toBe(66.7)
    expect(onTimePct({ due: 0, onTime: 0, late: 0, missed: 0, skipped: 0 })).toBeNull()
    expect(onTimePct({ due: 2, onTime: 0, late: 0, missed: 0, skipped: 2 })).toBeNull()
  })
})

describe('firstCallBuckets', () => {
  it('sorts minutes into buckets and counts leads never called', () => {
    const b = firstCallBuckets([2, 30, 90, 2000, null, null])
    expect(b).toEqual({ min5: 1, hour1: 1, day1: 1, later: 1, none: 2 })
  })
  it('a negative gap (clock skew) counts as within 5 minutes, not lost', () => {
    expect(firstCallBuckets([-1]).min5).toBe(1)
  })
})

describe('median', () => {
  it('middle value, average of two middles, null when empty', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('idleBucket', () => {
  it('buckets days without a touch; under 3 days is not idle', () => {
    expect(idleBucket(1)).toBeNull()
    expect(idleBucket(3)).toBe('d3')
    expect(idleBucket(7)).toBe('d7')
    expect(idleBucket(14)).toBe('d14')
    expect(idleBucket(45)).toBe('d30')
  })
})
