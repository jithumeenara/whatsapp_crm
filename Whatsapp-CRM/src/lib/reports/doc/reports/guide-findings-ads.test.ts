import { describe, expect, it } from 'vitest'
import { guideFindings, type GuideFacts } from './guide-findings'

const quiet: GuideFacts = {
  team: true, links: { leads: '/reports/leads?p', agents: '/reports/agents?p' },
  leads: { now: 50, before: 50 }, wonPct: { now: 20, before: 20, base: 50, prevBase: 50 },
  sources: [], steps: [], reply: { median: 10, answered: 40, slots: [] }, agents: [],
  followUps: { lateNow: 1, lateBefore: 1, overdueOpen: 0 }, idle: 0, neverContacted: 0, leakHours: 24,
}

describe('guide: ad and campaign checks', () => {
  it('an ad spending with no leads is called out, with the amount, linking to the Ad report', () => {
    const f = guideFindings({ ...quiet, ads: { link: '/reports/ads?p', currency: 'INR', noLeads: [{ name: 'Old banner', spend: 2000 }], costPerLead: { now: 300, before: 300 } } })
    const a = f.find((x) => x.title.includes('Old banner'))!
    expect(a.severity).toBe('high')
    expect(a.evidence).toMatch(/2,000/)
    expect(a.href).toBe('/reports/ads?p')
  })

  it('cost per lead rising by a third or more', () => {
    const f = guideFindings({ ...quiet, ads: { link: '/reports/ads?p', currency: 'INR', noLeads: [], costPerLead: { now: 420, before: 300 } } })
    expect(f.some((x) => /cost per lead rose/i.test(x.title))).toBe(true)
  })

  it('no ad facts (someone who may not see money) means no ad cards at all', () => {
    expect(guideFindings(quiet).some((x) => /ad|cost per lead/i.test(x.title))).toBe(false)
  })

  it('a broadcast where many sends failed, and opt-outs doubling', () => {
    const f = guideFindings({ ...quiet, broadcasts: { link: '/reports/campaigns?p', worstFailed: { name: 'Diwali', failed: 40, sent: 200 }, optOuts: { now: 24, before: 8 } } })
    expect(f.find((x) => x.title.includes('Diwali'))?.action?.href).toBe('/broadcasts')
    expect(f.some((x) => /opt-outs/i.test(x.title))).toBe(true)
  })

  it('a few failures or a few opt-outs say nothing', () => {
    const f = guideFindings({ ...quiet, broadcasts: { link: '/x', worstFailed: { name: 'Small', failed: 3, sent: 20 }, optOuts: { now: 4, before: 1 } } })
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('good')
  })
})
