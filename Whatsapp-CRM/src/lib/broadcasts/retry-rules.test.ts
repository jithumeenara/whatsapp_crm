import { describe, expect, it } from 'vitest'
import { pickRetryable } from './retry-rules'

const now = new Date('2026-10-18T12:00:00+05:30')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)
const row = (id: string, error: string, sentHoursAgo = 2) => ({ id, error_message: error, sent_at: hoursAgo(sentHoursAgo), created_at: hoursAgo(sentHoursAgo) })

describe('"Retry failed"', () => {
  it('retries passing problems now', () => {
    expect(pickRetryable([row('a', 'Rate limit hit (code 130429)'), row('b', 'Something odd')], now).retry).toEqual(['a', 'b'])
  })

  it('never retries people who cannot or must not get it', () => {
    const pick = pickRetryable([
      row('a', 'Not a WhatsApp user (code 131026)'),
      row('b', 'Opted out of marketing (code 131050)'),
      row('c', 'Invalid phone number format'),
      row('d', 'Template paused (code 132015)'),
    ], now)
    expect(pick.retry).toEqual([])
    expect(pick.skipped).toEqual({ cannot_receive: 3, template: 1, too_soon: 0 })
  })

  it('holds the marketing limit for a day, then retries it', () => {
    const fresh = row('a', 'Not delivered to maintain healthy ecosystem engagement. (code 131049)', 3)
    const old = row('b', 'Not delivered to maintain healthy ecosystem engagement. (code 131049)', 30)
    const pick = pickRetryable([fresh, old], now)
    expect(pick.retry).toEqual(['b'])
    expect(pick.skipped.too_soon).toBe(1)
  })
})
