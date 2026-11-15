import { describe, expect, it } from 'vitest'
import { dueKey, oneLine, periodFor, recipientMayGet, summaryText } from './rules'
import type { ReportDoc } from '../doc/types'

const at = (date: string, day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', hh: number, mm = 0) => ({ date, day, minutes: hh * 60 + mm })

describe('periodFor', () => {
  it('daily sends yesterday, weekly last week, monthly last month', () => {
    expect(periodFor('daily')).toBe('yesterday')
    expect(periodFor('weekly')).toBe('last_week')
    expect(periodFor('monthly')).toBe('last_month')
  })
})

describe('dueKey', () => {
  const daily = { frequency: 'daily', day: 1, send_hour: 9, last_sent_key: null as string | null }
  it('due from the chosen hour, for up to three hours; the key is the day', () => {
    expect(dueKey(daily, at('2026-11-16', 'mon', 8, 59))).toBeNull()
    expect(dueKey(daily, at('2026-11-16', 'mon', 9, 0))).toBe('2026-11-16')
    expect(dueKey(daily, at('2026-11-16', 'mon', 11, 59))).toBe('2026-11-16')
    expect(dueKey(daily, at('2026-11-16', 'mon', 12, 0))).toBeNull() // too late: skipped, not sent at noon
  })
  it('twice is once: the same key is never due again', () => {
    expect(dueKey({ ...daily, last_sent_key: '2026-11-16' }, at('2026-11-16', 'mon', 10))).toBeNull()
  })
  it('weekly only on its weekday; monthly only on its day, keyed by month', () => {
    const weekly = { ...daily, frequency: 'weekly', day: 1 }
    expect(dueKey(weekly, at('2026-11-16', 'mon', 9))).toBe('2026-11-16')
    expect(dueKey(weekly, at('2026-11-17', 'tue', 9))).toBeNull()
    const monthly = { ...daily, frequency: 'monthly', day: 1 }
    expect(dueKey(monthly, at('2026-12-01', 'tue', 9))).toBe('2026-12')
    expect(dueKey(monthly, at('2026-12-02', 'wed', 9))).toBeNull()
  })
  it('an unknown frequency is never due', () => {
    expect(dueKey({ ...daily, frequency: 'hourly' }, at('2026-11-16', 'mon', 9))).toBeNull()
  })
})

const doc: ReportDoc = {
  key: 'leads', title: 'Lead report', headline: '32 leads (+14% on before), 5 won.',
  period: { kind: 'last_week', firstDay: '2026-11-09', lastDay: '2026-11-15', timeZone: 'Asia/Kolkata' },
  scope: 'team', generatedAt: '',
  blocks: [
    { kind: 'kpis', id: 'k', items: [
      { label: 'Leads', value: '32', compare: { now: 32, before: 28, higherIsBetter: true, fmt: { kind: 'count' } } },
      { label: 'Won', value: '5', compare: { now: 5, before: 2, higherIsBetter: true, fmt: { kind: 'count' } } },
      { label: 'Won %', value: '15.6%' },
    ] },
    { kind: 'findings', id: 'f', items: [
      { severity: 'high', title: '12 leads were never contacted', evidence: 'e', suggestion: 's' },
      { severity: 'good', title: 'Nothing else', evidence: 'e', suggestion: 's' },
    ] },
  ],
}

describe('summaryText', () => {
  it('title and dates, the headline, figures with the shared change rule, serious findings, and the link', () => {
    const t = summaryText(doc, 'https://crm.example.com/reports/leads?period=last_week')
    expect(t).toContain('*Lead report*')
    expect(t).toContain('9 Nov – 15 Nov')
    expect(t).toContain('32 leads')
    expect(t).toContain('Leads: 32 (before 28, +14%)')
    expect(t).toContain('Won: 5 (before 2, Too few to judge)')
    expect(t).toContain('12 leads were never contacted')
    expect(t).not.toContain('Nothing else')
    expect(t).toContain('https://crm.example.com/reports/leads')
    expect(t.length).toBeLessThanOrEqual(1500)
  })
})

describe('oneLine', () => {
  it('fits a template variable: one line, no line breaks, not too long', () => {
    const l = oneLine(doc)
    expect(l).toContain('Lead report')
    expect(l).not.toMatch(/\n/)
    expect(l.length).toBeLessThanOrEqual(300)
  })
})

describe('recipientMayGet', () => {
  it('a team report goes to supervisors and above; money reports to owners and admins only', () => {
    expect(recipientMayGet('leads', 'supervisor')).toBe(true)
    expect(recipientMayGet('leads', 'agent')).toBe(false)
    expect(recipientMayGet('ads', 'supervisor')).toBe(false)
    expect(recipientMayGet('ads', 'admin')).toBe(true)
    expect(recipientMayGet('nope', 'owner')).toBe(false)
  })
})
