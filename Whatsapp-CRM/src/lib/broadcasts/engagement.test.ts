import { describe, expect, it } from 'vitest'
import { engagementDays, engagementWhere, isEngagementKind } from './engagement'

const now = new Date('2026-10-18T00:00:00Z')
const since = new Date('2026-09-18T00:00:00Z')

describe('engagement audiences', () => {
  it('counts only this account’s broadcasts, inside the window', () => {
    expect(engagementWhere('acc', 'replied', 30, now)).toEqual({
      broadcast_recipients: { some: { broadcast: { account_id: 'acc' }, status: 'replied', replied_at: { gte: since } } },
    })
  })

  it('"ignored" means got one and replied to none in the window', () => {
    const w = engagementWhere('acc', 'ignored', 30, now) as { AND: unknown[] }
    expect(w.AND).toHaveLength(2)
    expect(JSON.stringify(w.AND[1])).toContain('"none"')
  })

  it('accepts 1 to 365 days and known kinds only', () => {
    expect(engagementDays('30')).toBe(30)
    expect(engagementDays(0)).toBeNull()
    expect(engagementDays(400)).toBeNull()
    expect(engagementDays('x')).toBeNull()
    expect(isEngagementKind('ignored')).toBe(true)
    expect(isEngagementKind('everyone')).toBe(false)
  })
})
