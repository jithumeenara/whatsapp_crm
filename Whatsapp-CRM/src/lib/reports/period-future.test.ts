import { describe, expect, it } from 'vitest'
import { resolvePeriod } from './period'

/**
 * A custom range that starts after today used to be accepted, which made the
 * report's first day later than its last and the Meta ad-spend call fail
 * (found in review). It is refused, in plain words, by the caller.
 */
const NOW = new Date('2026-11-09T10:00:00Z')

describe('resolvePeriod: a range in the future', () => {
  it('refuses a range that starts after today', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2026-12-01', to: '2026-12-31' }, NOW, 'Asia/Kolkata')).toBeNull()
    expect(resolvePeriod({ kind: 'custom', from: '2026-11-10', to: '2026-11-12' }, NOW, 'Asia/Kolkata')).toBeNull()
  })

  it('still accepts a range that includes today, or ends before it', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2026-11-01', to: '2026-11-30' }, NOW, 'Asia/Kolkata')).not.toBeNull()
    expect(resolvePeriod({ kind: 'custom', from: '2026-11-09', to: '2026-11-09' }, NOW, 'Asia/Kolkata')).not.toBeNull()
    expect(resolvePeriod({ kind: 'custom', from: '2026-10-01', to: '2026-10-31' }, NOW, 'Asia/Kolkata')).not.toBeNull()
  })
})
