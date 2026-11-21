import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enabled: true,
  members: [{ telegram_id: '111' }, { telegram_id: '222' }] as Array<{ telegram_id: string }>,
  where: [] as Array<Record<string, unknown>>,
  bot: { token: 'T' } as null | { token: string },
  calls: [] as Array<Record<string, unknown>>,
  failFor: null as string | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    adminChatSettings: { findUnique: async () => ({ enabled: h.enabled }) },
    adminChatMember: { findMany: async ({ where }: { where: Record<string, unknown> }) => { h.where.push(where); return h.members } },
  },
}))
vi.mock('@/lib/telegram/store', () => ({ botForAccount: async () => h.bot }))
vi.mock('@/lib/telegram/format', () => ({ toTelegramHtml: (t: string) => t }))
vi.mock('@/lib/telegram/api', () => ({
  tgCall: async (_t: string, _m: string, body: Record<string, unknown>) => {
    if (body.chat_id === h.failFor) throw new Error('blocked')
    h.calls.push(body)
    return {}
  },
}))

import { sendTelegramStaffAlert } from './staff-telegram'

beforeEach(() => {
  h.enabled = true; h.members = [{ telegram_id: '111' }, { telegram_id: '222' }]
  h.where = []; h.bot = { token: 'T' }; h.calls = []; h.failFor = null
})

describe('sendTelegramStaffAlert', () => {
  it('reaches every active admin on Telegram who switched alerts on, inside their access dates', async () => {
    const n = await sendTelegramStaffAlert('acc', 'A customer needs a person', new Date('2026-11-21T10:00:00Z'))
    expect(n).toBe(2)
    expect(h.where[0]).toMatchObject({ account_id: 'acc', channel: 'telegram', status: 'active', alerts_enabled: true })
    expect(h.calls.map((c) => c.chat_id)).toEqual(['111', '222'])
    expect(h.calls[0]).toMatchObject({ protect_content: true })
  })

  it('sends nothing when Admin Chat is off or no bot is connected', async () => {
    h.enabled = false
    expect(await sendTelegramStaffAlert('acc', 'x')).toBe(0)
    h.enabled = true
    h.bot = null
    expect(await sendTelegramStaffAlert('acc', 'x')).toBe(0)
  })

  it('one blocked chat does not stop the others, and nothing throws', async () => {
    h.failFor = '111'
    expect(await sendTelegramStaffAlert('acc', 'x')).toBe(1)
  })
})
