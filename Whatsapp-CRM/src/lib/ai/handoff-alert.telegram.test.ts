import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Alert staff on Telegram" (Settings -> AI -> Hand off when unsure): off
// means a handover sends nothing on Telegram; on (the default) sends it
// even when the WhatsApp alert is off.

const h = vi.hoisted(() => ({ telegramOn: true, tgCalls: 0 }))

vi.mock('@/lib/db', () => ({
  prisma: {
    aiConfig: {
      findUnique: async () => ({ handoff_alert_enabled: false, handoff_alert_numbers: [], handoff_alert_template: null, handoff_alert_reasons: [], handoff_alert_params: null }),
    },
  },
}))
vi.mock('./staff-telegram', () => ({ sendTelegramStaffAlert: async () => { h.tgCalls++; return 1 } }))
vi.mock('./telegram-alert-setting', () => ({ telegramAlertsOn: async () => h.telegramOn }))

import { sendHandoffAlert } from './handoff-alert'

const INPUT = { accountId: 'acc', conversationId: 'c1', reason: 'low_confidence', customerMessage: 'fees?', contact: { name: 'Anu', phone: '919800000000' } }

beforeEach(() => { h.telegramOn = true; h.tgCalls = 0 })

describe('handover alert on Telegram', () => {
  it('is sent when the switch is on, even with WhatsApp alerts off', async () => {
    const r = await sendHandoffAlert(INPUT)
    expect(h.tgCalls).toBe(1)
    expect(r.telegram).toBe(1)
  })

  it('is not sent when the switch is off', async () => {
    h.telegramOn = false
    const r = await sendHandoffAlert(INPUT)
    expect(h.tgCalls).toBe(0)
    expect(r.telegram ?? 0).toBe(0)
  })
})
