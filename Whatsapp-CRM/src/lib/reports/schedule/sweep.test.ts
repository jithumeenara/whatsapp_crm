import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The scheduled-report sweep: due at its hour, claimed once (two server
 * processes never both send), sent only to recipients who may still see
 * the report, money only when every recipient may see money.
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  claimedKeys: new Map<string, string>(),
  profiles: [] as Array<{ user_id: string; account_role: string; user: { email: string } }>,
  members: [] as Array<Record<string, unknown>>,
  chatSent: [] as string[],
  emails: [] as string[],
  builds: [] as Array<{ canSeeMoney: boolean; kind: string }>,
  results: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    scheduledReport: {
      findMany: () => Promise.resolve(h.rows),
      updateMany: ({ where, data }: { where: { id: string }; data: { last_sent_key: string } }) => {
        // The database's conditional update: only one caller wins a key.
        if (h.claimedKeys.get(where.id) === data.last_sent_key) return Promise.resolve({ count: 0 })
        h.claimedKeys.set(where.id, data.last_sent_key)
        return Promise.resolve({ count: 1 })
      },
      update: ({ data }: { data: { last_result: string } }) => { h.results.push(data.last_result); return Promise.resolve({}) },
    },
    profile: { findMany: ({ where }: { where: { user_id: { in: string[] } } }) => Promise.resolve(h.profiles.filter((p) => where.user_id.in.includes(p.user_id))) },
    adminChatSettings: { findUnique: () => Promise.resolve({ account_id: 'acc', brief_template_name: 'report_ready' }) },
    adminChatMember: { findMany: ({ where }: { where: { user_id: { in: string[] } } }) => Promise.resolve(h.members.filter((m) => where.user_id.in.includes(m.user_id as string))) },
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/admin-chat/brief-sweep', () => ({
  sendToAdmin: (m: { user_id: string }) => { h.chatSent.push(m.user_id); return Promise.resolve('text') },
}))
vi.mock('@/lib/messaging/channels/email', () => ({ sendEmail: (a: { to: string }) => { h.emails.push(a.to); return Promise.resolve({ messageId: 'm' }) } }))
vi.mock('../doc/business', () => ({ loadDocBusiness: () => Promise.resolve({ business: { name: 'B', lines: [], taxId: null, logo: null, brandColor: null }, language: 'en' }) }))
vi.mock('../doc/pdf', () => ({ docToPdf: () => Promise.resolve(Buffer.from('%PDF')) }))
vi.mock('../doc/registry', () => ({
  findReport: (key: string) => key === 'nope' ? undefined : ({
    key, title: 'Lead report', path: `/reports/${key}`, money: key === 'ads',
    build: (c: { q: { kind: string } }, o: { canSeeMoney: boolean }) => {
      h.builds.push({ canSeeMoney: o.canSeeMoney, kind: c.q.kind })
      return Promise.resolve({ key, title: 'Lead report', headline: '32 leads.', period: { kind: c.q.kind, firstDay: '2026-11-15', lastDay: '2026-11-15', timeZone: 'Asia/Kolkata' }, scope: 'team', blocks: [], generatedAt: '' })
    },
  }),
}))

import { sweepScheduledReports } from './sweep'

// 09:30 in Kolkata on Monday 16 Nov 2026.
const NOW = new Date('2026-11-16T04:00:00Z')
const member = (user_id: string) => ({ user_id, account_id: 'acc', channel: 'whatsapp', status: 'active', verified_at: new Date(), valid_from: new Date('2026-01-01'), valid_until: new Date('2027-01-01'), allowed_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_minute: 0, end_minute: 1440 })

beforeEach(() => {
  h.rows = [{ id: 's1', account_id: 'acc', report_key: 'leads', frequency: 'daily', day: 1, send_hour: 9, recipient_ids: ['owner1', 'sup1', 'agent1'], by_chat: true, by_email: true, enabled: true, last_sent_key: null }]
  h.claimedKeys = new Map()
  h.profiles = [
    { user_id: 'owner1', account_role: 'owner', user: { email: 'owner@biz.test' } },
    { user_id: 'sup1', account_role: 'supervisor', user: { email: 'sup@biz.test' } },
    { user_id: 'agent1', account_role: 'agent', user: { email: 'agent@biz.test' } },
  ]
  h.members = [member('owner1'), member('sup1')]
  h.chatSent = []; h.emails = []; h.builds = []; h.results = []
})

describe('sweepScheduledReports', () => {
  it("sends yesterday's report at its hour to supervisors and above, never to an agent on the list", async () => {
    expect(await sweepScheduledReports(NOW)).toEqual({ sent: 1 })
    expect(h.builds).toEqual([{ canSeeMoney: false, kind: 'yesterday' }])
    expect(h.chatSent.sort()).toEqual(['owner1', 'sup1'])
    expect(h.emails.sort()).toEqual(['owner@biz.test', 'sup@biz.test'])
    expect(h.results[0]).toMatch(/2 by WhatsApp\/Telegram, 2 by email/)
  })

  it('twice is once: a second process in the same hour sends nothing', async () => {
    await Promise.all([sweepScheduledReports(NOW), sweepScheduledReports(NOW)])
    await sweepScheduledReports(new Date(NOW.getTime() + 5 * 60_000))
    expect(h.builds).toHaveLength(1)
    expect(h.emails).toHaveLength(2)
  })

  it('money only when every recipient may see money', async () => {
    h.rows[0].recipient_ids = ['owner1']
    await sweepScheduledReports(NOW)
    expect(h.builds[0].canSeeMoney).toBe(true)
  })

  it('a money report never reaches a supervisor', async () => {
    h.rows[0].report_key = 'ads'
    await sweepScheduledReports(NOW)
    expect(h.chatSent).toEqual(['owner1'])
    expect(h.emails).toEqual(['owner@biz.test'])
  })

  it('not its hour, or nobody may see it: nothing is built', async () => {
    await sweepScheduledReports(new Date('2026-11-16T01:00:00Z')) // 06:30
    expect(h.builds).toHaveLength(0)
    h.profiles = [{ user_id: 'agent1', account_role: 'agent', user: { email: 'agent@biz.test' } }]
    await sweepScheduledReports(NOW)
    expect(h.builds).toHaveLength(0)
    expect(h.results[0]).toMatch(/Nobody on the list/)
  })
})
