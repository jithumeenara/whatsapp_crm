import { describe, expect, it } from 'vitest'
import { guideFindings, slotLabel, type GuideFacts } from './guide-findings'

const L = { leads: '/reports/leads?p', agents: '/reports/agents?p' }
const quiet: GuideFacts = {
  team: true, links: L,
  leads: { now: 50, before: 50 }, wonPct: { now: 20, before: 20, base: 50, prevBase: 50 },
  sources: [], steps: [], reply: { median: 10, answered: 40, slots: [] }, agents: [],
  followUps: { lateNow: 1, lateBefore: 1, overdueOpen: 0 }, idle: 0, neverContacted: 0, leakHours: 24,
}

describe('guideFindings', () => {
  it('nothing wrong is one good card', () => {
    const f = guideFindings(quiet)
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('good')
  })

  it('a fall in leads names the source behind most of it, and links to compare sources', () => {
    const f = guideFindings({
      ...quiet,
      leads: { now: 39, before: 50 },
      sources: [{ key: 'instagram_ad', label: 'Instagram ad', now: 10, before: 19 }, { key: 'website', label: 'Website', now: 29, before: 31 }],
    })
    const drop = f.find((x) => x.title.startsWith('Leads fell'))!
    expect(drop.severity).toBe('medium')
    expect(drop.evidence).toContain('Instagram ad')
    expect(drop.evidence).toContain('82%')
    expect(drop.action?.href).toContain('tab=compare&cmp=source')
    expect(drop.action?.href).toContain('instagram_ad')
  })

  it('a small "before" never makes a trend', () => {
    expect(guideFindings({ ...quiet, leads: { now: 2, before: 8 } }).some((x) => x.title.startsWith('Leads fell'))).toBe(false)
  })

  it('a stage that dropped 10+ points on enough leads is called out', () => {
    const f = guideFindings({ ...quiet, steps: [{ from: 'Appointment', to: 'Visited', rate: 61, previousRate: 88, base: 30, prevBase: 25 }] })
    const s = f.find((x) => x.title.includes('Appointment → Visited'))!
    expect(s.severity).toBe('high')
    expect(s.evidence).toContain('88%')
  })

  it('a slow time slot is named when it is much slower than usual', () => {
    const f = guideFindings({ ...quiet, reply: { median: 30, answered: 60, slots: [{ label: 'Saturday evening', median: 840, leads: 7 }, { label: 'Monday morning', median: 12, leads: 20 }] } })
    const s = f.find((x) => x.title.includes('Saturday evening'))!
    expect(s.title).toContain('14 h')
  })

  it('a team member far below the team answer rate gets a card linking to their report card', () => {
    const f = guideFindings({
      ...quiet,
      agents: [
        { userId: 'u1', name: 'Anugraha', calls: 60, connected: 20 },
        { userId: 'u2', name: 'Ravi', calls: 80, connected: 56 },
        { userId: 'u3', name: 'Few', calls: 5, connected: 0 },
      ],
    })
    const a = f.find((x) => x.title.includes('Anugraha'))!
    expect(a.action?.href).toContain('member=u1')
    expect(f.some((x) => x.title.includes('Few'))).toBe(false)
  })

  it('people cards only on the team guide', () => {
    const f = guideFindings({ ...quiet, team: false, agents: [{ userId: 'u1', name: 'A', calls: 60, connected: 5 }, { userId: 'u2', name: 'B', calls: 60, connected: 50 }] })
    expect(f.some((x) => x.title.includes('A '))).toBe(false)
  })

  it('late follow-ups rising, never-contacted and idle leads come with something to do', () => {
    const f = guideFindings({ ...quiet, followUps: { lateNow: 19, lateBefore: 3, overdueOpen: 12 }, neverContacted: 11, idle: 15 })
    expect(f.find((x) => /follow-ups/i.test(x.title))?.action?.href).toBe('/follow-ups')
    expect(f.find((x) => /never contacted/i.test(x.title))?.severity).toBe('high')
    expect(f.find((x) => /not touched/i.test(x.title))?.action?.href).toBe('/leads')
  })

  it('most serious first', () => {
    const f = guideFindings({ ...quiet, idle: 4, neverContacted: 12 })
    expect(f[0].severity).toBe('high')
  })

  it('everything is written by code, never marked as AI', () => {
    expect(guideFindings({ ...quiet, idle: 20 }).every((x) => !x.byAi)).toBe(true)
  })
})

describe('slotLabel', () => {
  it('weekday and part of the day, business time', () => {
    expect(slotLabel(6, 19)).toBe('Saturday evening')
    expect(slotLabel(1, 9)).toBe('Monday morning')
    expect(slotLabel(0, 2)).toBe('Sunday night')
  })
})
