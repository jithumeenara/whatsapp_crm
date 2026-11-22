import { beforeEach, describe, expect, it, vi } from 'vitest'

// Security review (2026-11-21): the handover alert on Telegram carries a
// customer's name, number and message. It must reach only people Admin
// Chat itself would show that to: still owner/admin of THIS account,
// verified, inside their allowed days and hours — and a 'reports' member
// (promised "no personal details") gets no name, number or message; a
// 'lookup' member sees the number masked.

type Member = {
  telegram_id: string; user_id: string; scope: string; verified_at: Date | null
  valid_from: Date; valid_until: Date; allowed_days: string[]; start_minute: number; end_minute: number
}

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const member = (id: string, over: Partial<Member> = {}): Member => ({
  telegram_id: id, user_id: `u${id}`, scope: 'actions', verified_at: new Date('2026-11-01'),
  valid_from: new Date('2026-11-01T00:00:00Z'), valid_until: new Date('2026-12-31T00:00:00Z'),
  allowed_days: ALL_DAYS, start_minute: 0, end_minute: 1440, ...over,
})

const h = vi.hoisted(() => ({
  enabled: true,
  members: [] as Member[],
  profiles: {} as Record<string, { account_id: string; account_role: string }>,
  where: [] as Array<Record<string, unknown>>,
  bot: { token: 'T' } as null | { token: string },
  calls: [] as Array<{ chat_id: string; text: string }>,
  failFor: null as string | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    adminChatSettings: { findUnique: async () => ({ enabled: h.enabled }) },
    adminChatMember: { findMany: async ({ where }: { where: Record<string, unknown> }) => { h.where.push(where); return h.members } },
    profile: {
      findMany: async ({ where }: { where: { user_id: { in: string[] } } }) =>
        where.user_id.in.filter((id) => h.profiles[id]).map((id) => ({ user_id: id, ...h.profiles[id] })),
    },
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/telegram/store', () => ({ botForAccount: async () => h.bot }))
vi.mock('@/lib/telegram/format', () => ({ toTelegramHtml: (t: string) => t }))
vi.mock('@/lib/telegram/api', () => ({
  tgCall: async (_t: string, _m: string, body: { chat_id: string; text: string }) => {
    if (body.chat_id === h.failFor) throw new Error('blocked')
    h.calls.push(body)
    return {}
  },
}))

import { sendTelegramStaffAlert, type StaffAlert } from './staff-telegram'

const ALERT: StaffAlert = { who: 'Anu Mathew', phone: '919847012345', quote: 'fees ethra?', reason: 'low confidence' }
// 10:00 IST on a Saturday.
const NOW = new Date('2026-11-21T04:30:00Z')

beforeEach(() => {
  h.enabled = true
  h.members = [member('111'), member('222')]
  h.profiles = { u111: { account_id: 'acc', account_role: 'owner' }, u222: { account_id: 'acc', account_role: 'admin' } }
  h.where = []; h.bot = { token: 'T' }; h.calls = []; h.failFor = null
})

describe('sendTelegramStaffAlert', () => {
  it('reaches active, verified admins of this account who switched alerts on', async () => {
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(2)
    expect(h.where[0]).toMatchObject({ account_id: 'acc', channel: 'telegram', status: 'active', alerts_enabled: true, verified_at: { not: null } })
    expect(h.calls[0].text).toContain('919847012345')
    expect(h.calls[0].text).toContain('fees ethra?')
  })

  it('never reaches somebody removed from the team or demoted below admin', async () => {
    h.profiles = { u111: { account_id: 'holding-acc', account_role: 'viewer' }, u222: { account_id: 'acc', account_role: 'agent' } }
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(0)
    expect(h.calls).toHaveLength(0)
  })

  it('a "reports" member is told only that a customer needs a person — no name, number or message', async () => {
    h.members = [member('111', { scope: 'reports' })]
    await sendTelegramStaffAlert('acc', ALERT, NOW)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].text).not.toContain('Anu')
    expect(h.calls[0].text).not.toContain('9847012345')
    expect(h.calls[0].text).not.toContain('fees ethra')
  })

  it('a "lookup" member sees the number masked', async () => {
    h.members = [member('111', { scope: 'lookup' })]
    await sendTelegramStaffAlert('acc', ALERT, NOW)
    expect(h.calls[0].text).not.toContain('919847012345')
    expect(h.calls[0].text).toContain('2345')
  })

  it('respects the member’s allowed days and hours', async () => {
    h.members = [member('111', { allowed_days: ['mon'] }), member('222', { start_minute: 18 * 60, end_minute: 1440 })]
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(0)
  })

  it('sends nothing when Admin Chat is off or no bot is connected', async () => {
    h.enabled = false
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(0)
    h.enabled = true
    h.bot = null
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(0)
  })

  it('one blocked chat does not stop the others, and nothing throws', async () => {
    h.failFor = '111'
    expect(await sendTelegramStaffAlert('acc', ALERT, NOW)).toBe(1)
  })
})
