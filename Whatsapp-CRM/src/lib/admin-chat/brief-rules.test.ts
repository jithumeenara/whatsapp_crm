import { describe, expect, it } from 'vitest'
import { briefOneLine, composeBrief, dueForAlert, dueForBrief, previousDate, templateVariableCount, withinServiceWindow, zonedDayRange } from './brief-rules'

describe('a day in the business time zone', () => {
  it('Kolkata midnight is 18:30 UTC the day before', () => {
    const r = zonedDayRange('2026-10-19', 'Asia/Kolkata')
    expect(r.start.toISOString()).toBe('2026-10-18T18:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-10-19T18:30:00.000Z')
  })
  it('a zone behind UTC, and the day before a date', () => {
    expect(zonedDayRange('2026-10-19', 'America/New_York').start.toISOString()).toBe('2026-10-19T04:00:00.000Z')
    expect(previousDate('2026-03-01')).toBe('2026-02-28')
  })
})

const stats = { date: '2026-10-19', newChats: 34, byChannel: { whatsapp: 30, telegram: 4 }, newLeads: 12, customerMessages: 410, waitingNow: 5, unassignedNow: 8 }

describe('the brief', () => {
  it('counts only — and how to ask for more', () => {
    const text = composeBrief(stats, 'ADMIN')
    expect(text).toContain('*34*')
    expect(text).toContain('WhatsApp 30')
    expect(text).toContain('Telegram 4')
    expect(text).toContain('*12*')
    expect(text).toContain('*5*')
    expect(text).toContain('ADMIN')
  })
  it('one line for a WhatsApp template (no line breaks allowed in a variable)', () => {
    const line = briefOneLine(stats)
    expect(line).not.toMatch(/\n/)
    expect(line).toBe('34 new chats, 12 new leads yesterday; 5 waiting for the team, 8 unassigned now')
  })
})

describe('when to send', () => {
  const member = { brief_enabled: true, brief_minute: 9 * 60, last_brief_date: null as Date | null }
  it('a brief once a day, from its time, not hours late', () => {
    expect(dueForBrief(member, { date: '2026-10-20', minutes: 8 * 60 + 59 })).toBe(false)
    expect(dueForBrief(member, { date: '2026-10-20', minutes: 9 * 60 })).toBe(true)
    expect(dueForBrief({ ...member, last_brief_date: new Date('2026-10-20T00:00:00Z') }, { date: '2026-10-20', minutes: 9 * 60 + 5 })).toBe(false)
    expect(dueForBrief(member, { date: '2026-10-20', minutes: 13 * 60 })).toBe(false)
    expect(dueForBrief({ ...member, brief_enabled: false }, { date: '2026-10-20', minutes: 9 * 60 })).toBe(false)
  })
  it('an alert when the waiting pile reaches the line, at most every 3 hours', () => {
    const now = new Date('2026-10-20T10:00:00Z')
    const m = { alerts_enabled: true, last_alert_at: null as Date | null }
    expect(dueForAlert(m, 9, 10, now)).toBe(false)
    expect(dueForAlert(m, 10, 10, now)).toBe(true)
    expect(dueForAlert({ ...m, last_alert_at: new Date('2026-10-20T08:00:00Z') }, 15, 10, now)).toBe(false)
    expect(dueForAlert({ ...m, last_alert_at: new Date('2026-10-20T06:59:00Z') }, 15, 10, now)).toBe(true)
  })
})

describe('WhatsApp rules', () => {
  it('free text only within 24 hours of their last message', () => {
    const now = new Date('2026-10-20T10:00:00Z')
    expect(withinServiceWindow(new Date('2026-10-19T11:00:00Z'), now)).toBe(true)
    expect(withinServiceWindow(new Date('2026-10-19T09:59:00Z'), now)).toBe(false)
    expect(withinServiceWindow(null, now)).toBe(false)
  })
  it('a template needs exactly two body variables', () => {
    expect(templateVariableCount('Daily update for {{1}}: {{2}}. Reply ADMIN for details.')).toBe(2)
    expect(templateVariableCount('Hello {{1}}, {{1}} again')).toBe(1)
    expect(templateVariableCount('Hi {{name}}, {{summary}}')).toBe(2)
  })
})
