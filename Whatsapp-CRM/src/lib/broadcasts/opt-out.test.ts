import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> }))

vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        h.updates.push(a)
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { preferenceIntent, setMarketingConsent } from './opt-out'
import { parseBroadcastSettings } from './settings'

beforeEach(() => { h.updates = [] })

describe('opting out of campaigns', () => {
  it('reads Meta’s Stop promotions / Resume buttons', () => {
    expect(preferenceIntent({ category: 'marketing_messages', value: 'stop' })).toBe('stop')
    expect(preferenceIntent({ category: 'marketing_messages', value: 'resume' })).toBe('start')
    expect(preferenceIntent({ category: 'something_else', value: 'stop' })).toBeNull()
  })

  it('opts out only inside the account and only if not already out', async () => {
    await setMarketingConsent({ accountId: 'acc', contactId: 'c1', intent: 'stop', source: 'stop_keyword' })
    expect(h.updates[0].where).toEqual({ id: 'c1', account_id: 'acc', opt_in_status: { not: 'opted_out' } })
    expect(h.updates[0].data.opt_in_status).toBe('opted_out')
  })

  it('START only brings back someone who had opted out', async () => {
    await setMarketingConsent({ accountId: 'acc', contactId: 'c1', intent: 'start', source: 'stop_keyword' })
    expect(h.updates[0].where).toEqual({ id: 'c1', account_id: 'acc', opt_in_status: 'opted_out' })
    expect(h.updates[0].data).toMatchObject({ opt_in_status: 'opted_in', opted_out_at: null })
  })
})

describe('broadcast rules settings', () => {
  it('fills defaults and refuses out-of-range numbers', () => {
    const ok = parseBroadcastSettings({})
    expect('value' in ok && ok.value).toMatchObject({ frequency_cap_count: 2, frequency_cap_days: 7, stop_keywords_enabled: true })
    expect(parseBroadcastSettings({ frequency_cap_count: 0 })).toHaveProperty('error')
    expect(parseBroadcastSettings({ frequency_cap_days: 91 })).toHaveProperty('error')
    expect(parseBroadcastSettings({ frequency_cap_count: 2.5 })).toHaveProperty('error')
  })
})
