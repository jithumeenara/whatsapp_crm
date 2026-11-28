import { beforeEach, describe, expect, it, vi } from 'vitest'

// A business that removes this app in Meta (account_update PARTNER_REMOVED)
// left the number "connected" here while every send failed. It is now
// marked disconnected with a plain reason, once; other events change nothing.

const h = vi.hoisted(() => ({ updates: [] as Array<{ where: unknown; data: unknown }>, pushes: 0 }))

vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: {
      findMany: async () => [{ id: 'cfg1', user_id: 'u1' }],
      updateMany: async (a: { where: unknown; data: unknown }) => { h.updates.push(a); return { count: 1 } },
      update: async () => ({}),
    },
  },
}))
vi.mock('@/lib/push', () => ({ sendPushToUser: async () => { h.pushes++ } }))

import { handleAccountAlertChange, isAccountAlertField } from './account-webhook'

beforeEach(() => { h.updates = []; h.pushes = 0 })

describe('account_update partner events', () => {
  it('is a handled field', () => {
    expect(isAccountAlertField('account_update')).toBe(true)
  })

  it('PARTNER_REMOVED disconnects the WABA’s numbers and tells the owner', async () => {
    await handleAccountAlertChange({ field: 'account_update', value: { event: 'PARTNER_REMOVED', waba_info: { waba_id: '1234567' } } }, '1234567')
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toMatchObject({
      where: { waba_id: '1234567', status: { not: 'disconnected' } },
      data: { status: 'disconnected' },
    })
    expect(h.pushes).toBe(1)
  })

  it('other account_update events change nothing', async () => {
    await handleAccountAlertChange({ field: 'account_update', value: { event: 'PARTNER_ADDED' } }, '1234567')
    await handleAccountAlertChange({ field: 'account_update', value: { event: 'ACCOUNT_RECONNECTED' } }, '1234567')
    expect(h.updates).toHaveLength(0)
    expect(h.pushes).toBe(0)
  })

  it('ignores a WABA id that is not Meta digits', async () => {
    await handleAccountAlertChange({ field: 'account_update', value: { event: 'PARTNER_REMOVED', waba_info: { waba_id: 'x;drop' } } }, 'x')
    expect(h.updates).toHaveLength(0)
  })
})
