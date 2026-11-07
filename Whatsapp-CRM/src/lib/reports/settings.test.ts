import { describe, expect, it } from 'vitest'
import { FUNNEL_TEMPLATES, parseFunnel, parseReportSettings, validateFunnel, validateReportSettings } from './settings'

describe('funnel stages', () => {
  it('keeps the business’s own names and maps each to open, won or lost', () => {
    expect(parseFunnel([{ label: 'Appointment', outcome: 'open' }, { label: 'Surgery', outcome: 'won' }])).toEqual([
      { key: 'appointment', label: 'Appointment', outcome: 'open' },
      { key: 'surgery', label: 'Surgery', outcome: 'won' },
    ])
  })

  it('a renamed stage keeps its key, so its history stays with it', () => {
    expect(parseFunnel([{ key: 'appointment', label: 'Consultation booked', outcome: 'open' }])[0].key).toBe('appointment')
  })

  it('works for Malayalam names', () => {
    expect(parseFunnel([{ label: 'രജിസ്റ്റർ ചെയ്തു', outcome: 'open' }])[0].label).toBe('രജിസ്റ്റർ ചെയ്തു')
  })

  it('a malformed stored value never breaks: bad rows are dropped, unknown outcome is open', () => {
    expect(parseFunnel('nonsense')).toEqual([])
    expect(parseFunnel([null, { label: '' }, { label: 'X', outcome: 'maybe' }])).toEqual([{ key: 'x', label: 'X', outcome: 'open' }])
  })

  it('refuses a list an admin should fix, in plain words', () => {
    expect(validateFunnel([{ label: '' }])).toEqual({ ok: false, error: 'Every stage needs a name.' })
    expect(validateFunnel([{ label: 'A' }, { label: 'a' }])).toEqual({ ok: false, error: 'Two stages have the same name.' })
    expect(validateFunnel(Array.from({ length: 13 }, (_, i) => ({ label: `S${i}` }))).ok).toBe(false)
    expect(validateFunnel([{ label: 'x'.repeat(41) }]).ok).toBe(false)
  })

  it('every template is valid and ends in a win', () => {
    for (const t of Object.values(FUNNEL_TEMPLATES)) {
      expect(validateFunnel(t.stages).ok).toBe(true)
      expect(t.stages.some((s) => s.outcome === 'won')).toBe(true)
    }
  })
})

describe('report settings', () => {
  it('defaults when nothing is stored', () => {
    expect(parseReportSettings(null)).toEqual({ leakHours: null, manualSpend: [] })
  })

  it('keeps valid manual spend rows', () => {
    const s = parseReportSettings({ leakHours: 12, manualSpend: [{ month: '2026-10', source: 'Newspaper', amount: '18647.5', currency: 'inr' }] })
    expect(s).toEqual({ leakHours: 12, manualSpend: [{ month: '2026-10', source: 'Newspaper', amount: 18647.5, currency: 'INR' }] })
  })

  it('refuses bad input rather than silently dropping it', () => {
    expect(validateReportSettings({ leakHours: 0 }).ok).toBe(false)
    expect(validateReportSettings({ manualSpend: [{ month: '2026-13', source: 'X', amount: 1, currency: 'INR' }] }).ok).toBe(false)
    expect(validateReportSettings({ manualSpend: [{ month: '2026-10', source: 'X', amount: -5, currency: 'INR' }] }).ok).toBe(false)
    expect(validateReportSettings({ leakHours: 24, manualSpend: [] })).toEqual({ ok: true, settings: { leakHours: 24, manualSpend: [] } })
  })
})
