import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Red alerts: red cards only, to owners and supervisors on Admin Chat
 * inside their hours, ad money only to owners and admins, and once per
 * issue per day even when two processes sweep at the same time.
 */

const member = (user_id: string) => ({ user_id, account_id: 'acc', status: 'active', verified_at: new Date(), alerts_enabled: true, valid_from: new Date('2026-01-01'), valid_until: new Date('2027-01-01'), allowed_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_minute: 0, end_minute: 1440 })

const h = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  roles: [] as Array<{ user_id: string; account_role: string }>,
  findings: [] as Array<Record<string, unknown>>,
  claimed: new Set<string>(),
  sent: [] as Array<{ to: string; text: string }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    adminChatMember: { findMany: () => Promise.resolve(h.members) },
    adminChatSettings: { findUnique: () => Promise.resolve({ account_id: 'acc', brief_template_name: 't' }) },
    profile: { findMany: () => Promise.resolve(h.roles) },
    reportAlertLog: {
      createMany: ({ data }: { data: Array<{ code: string; sent_on: Date }> }) => {
        const key = `${data[0].code}|${data[0].sent_on.toISOString()}`
        if (h.claimed.has(key)) return Promise.resolve({ count: 0 })
        h.claimed.add(key)
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('../doc/reports/guide', () => ({ loadGuide: () => Promise.resolve({ findings: h.findings, facts: {} }) }))
vi.mock('@/lib/admin-chat/brief-sweep', () => ({
  sendToAdmin: (m: { user_id: string }, _s: unknown, text: string) => { h.sent.push({ to: m.user_id, text }); return Promise.resolve('text') },
}))

import { sweepReportAlerts } from './sweep'

const NOW = new Date('2026-11-16T06:00:00Z')

beforeEach(() => {
  h.members = [member('owner1'), member('sup1'), member('agent1')]
  h.roles = [{ user_id: 'owner1', account_role: 'owner' }, { user_id: 'sup1', account_role: 'supervisor' }, { user_id: 'agent1', account_role: 'agent' }]
  h.findings = [
    { severity: 'high', code: 'never_contacted', title: '12 leads were never contacted', evidence: 'e', suggestion: 's' },
    { severity: 'medium', code: 'slow_reply', title: 'slow', evidence: 'e', suggestion: 's' },
  ]
  h.claimed = new Set()
  h.sent = []
})

describe('sweepReportAlerts', () => {
  it('a red card goes to the owner and the supervisor, never to an agent; medium cards wait for the report', async () => {
    await sweepReportAlerts(NOW)
    expect(h.sent.map((s) => s.to).sort()).toEqual(['owner1', 'sup1'])
    expect(h.sent[0].text).toContain('12 leads were never contacted')
  })

  it('once per issue per day, even with two processes at once', async () => {
    await Promise.all([sweepReportAlerts(NOW), sweepReportAlerts(NOW)])
    await sweepReportAlerts(new Date(NOW.getTime() + 30 * 60_000))
    expect(h.sent).toHaveLength(2)
  })

  it('ad money alerts reach owners and admins only', async () => {
    h.findings = [{ severity: 'high', code: 'ad_no_leads:Old banner', money: true, title: 'Old banner', evidence: 'e', suggestion: 's' }]
    await sweepReportAlerts(NOW)
    expect(h.sent.map((s) => s.to)).toEqual(['owner1'])
  })

  it('nobody inside their hours: nothing is built or claimed', async () => {
    h.members = [{ ...member('owner1'), start_minute: 0, end_minute: 1 }]
    await sweepReportAlerts(NOW)
    expect(h.sent).toHaveLength(0)
    expect(h.claimed.size).toBe(0)
  })
})
