import { describe, it, expect } from 'vitest'
import { outcomeTitle, parseOutcomeInput } from './follow-up-outcome'

const NOW = new Date('2026-09-24T06:00:00Z')
const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString()

describe('parseOutcomeInput', () => {
  it('accepts Done with an optional note', () => {
    const r = parseOutcomeInput({ outcome: 'done', note: ' Will visit Monday ' }, NOW)
    expect(r).toEqual({ ok: true, outcome: 'done', note: 'Will visit Monday', nextAt: null })
  })

  it('needs a new time to reschedule', () => {
    expect(parseOutcomeInput({ outcome: 'rescheduled' }, NOW).ok).toBe(false)
    const r = parseOutcomeInput({ outcome: 'rescheduled', next_at: later }, NOW)
    expect(r.ok && r.nextAt?.toISOString()).toBe(later)
  })

  it("takes Couldn't reach with or without a retry time", () => {
    expect(parseOutcomeInput({ outcome: 'not_reached' }, NOW).ok).toBe(true)
    const r = parseOutcomeInput({ outcome: 'not_reached', next_at: later }, NOW)
    expect(r.ok && r.nextAt).toBeTruthy()
  })

  it('refuses a past, far-off or unreadable time', () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    for (const next_at of [past, '2028-01-01T00:00:00Z', 'tomorrow', 5]) {
      expect(parseOutcomeInput({ outcome: 'rescheduled', next_at }, NOW).ok, String(next_at)).toBe(false)
    }
  })

  it('refuses a next time on Done, and anything that is not an outcome', () => {
    expect(parseOutcomeInput({ outcome: 'done', next_at: later }, NOW).ok).toBe(false)
    expect(parseOutcomeInput({ outcome: 'deleted' }, NOW).ok).toBe(false)
    expect(parseOutcomeInput(null, NOW).ok).toBe(false)
  })

  it('caps the note', () => {
    const r = parseOutcomeInput({ outcome: 'done', note: 'x'.repeat(5000) }, NOW)
    expect(r.ok && r.note?.length).toBe(1000)
  })
})

describe('outcomeTitle', () => {
  it('reads the way people say it', () => {
    expect(outcomeTitle('done')).toBe('Follow-up done')
    expect(outcomeTitle('rescheduled')).toBe('Follow-up rescheduled')
    expect(outcomeTitle('not_reached')).toMatch(/reach the customer/)
  })
})
