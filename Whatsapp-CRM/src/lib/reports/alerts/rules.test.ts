import { describe, expect, it } from 'vitest'
import { alertLine, alertText, mayGetAlert, pickAlerts } from './rules'
import type { Finding } from '../doc/types'

const f = (o: Partial<Finding>): Finding => ({ severity: 'high', title: '12 leads were never contacted', evidence: 'Older than 24 hours.', suggestion: 'Call them today.', code: 'never_contacted', ...o })

describe('pickAlerts', () => {
  it('only the red (high) cards with a stable code', () => {
    const picked = pickAlerts([f({}), f({ severity: 'medium', code: 'slow_reply' }), f({ code: undefined }), f({ severity: 'good', code: 'nothing' })])
    expect(picked.map((x) => x.code)).toEqual(['never_contacted'])
  })
  it('at most five a time, so a bad day is not a flood', () => {
    expect(pickAlerts(Array.from({ length: 9 }, (_, i) => f({ code: `c${i}` })))).toHaveLength(5)
  })
})

describe('mayGetAlert', () => {
  it('owners and supervisors (and admins between them); ad money to owners and admins only', () => {
    expect(mayGetAlert(f({}), 'supervisor')).toBe(true)
    expect(mayGetAlert(f({}), 'owner')).toBe(true)
    expect(mayGetAlert(f({}), 'agent')).toBe(false)
    expect(mayGetAlert(f({ money: true }), 'supervisor')).toBe(false)
    expect(mayGetAlert(f({ money: true }), 'admin')).toBe(true)
  })
})

describe('alertText / alertLine', () => {
  it('says it is urgent, what, the evidence, what to do and where to look', () => {
    const t = alertText(f({}), 'https://crm.example.com/reports/guide')
    expect(t).toContain('Alert')
    expect(t).toContain('12 leads were never contacted')
    expect(t).toContain('Call them today.')
    expect(t).toContain('https://crm.example.com/reports/guide')
  })
  it('one line for a template, no line breaks, not too long', () => {
    const l = alertLine(f({ title: 'x'.repeat(400) }))
    expect(l).not.toMatch(/\n/)
    expect(l.length).toBeLessThanOrEqual(300)
  })
})
