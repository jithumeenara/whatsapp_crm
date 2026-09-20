import { describe, expect, it } from 'vitest'
import { outcomeOf } from './outcome'

describe('outcomeOf', () => {
  it('says nothing about a lead that is not closed', () => {
    // "Is it closed" and "how did it end" are different questions, and
    // an open lead has no answer to the second.
    expect(outcomeOf({ status: 'new' })).toBeNull()
    expect(outcomeOf({ status: 'open', converted_at: '2026-09-01' })).toBeNull()
    expect(outcomeOf({ status: 'follow_up', lost_reason: 'Budget' })).toBeNull()
  })

  it('reads a recorded conversion as won', () => {
    expect(outcomeOf({ status: 'closed', converted_at: '2026-09-20T10:00:00Z' })).toBe('won')
    expect(outcomeOf({ status: 'closed', converted_at: new Date() })).toBe('won')
  })

  it('reads a reason as lost', () => {
    expect(outcomeOf({ status: 'closed', lost_reason: 'Not Interested' })).toBe('lost')
  })

  it('does not call an empty reason a loss', () => {
    // A blank string is a field that was touched and left, not a defeat
    // anybody reported.
    expect(outcomeOf({ status: 'closed', lost_reason: '   ' })).toBe('closed')
    expect(outcomeOf({ status: 'closed', lost_reason: '' })).toBe('closed')
  })

  it('leaves a lead closed without an outcome as closed', () => {
    // Bulk close records neither marker, and so did everything closed
    // before the dialog existed. Guessing Lost for these would invent a
    // defeat nobody reported and spoil every conversion figure that
    // counts them.
    expect(outcomeOf({ status: 'closed' })).toBe('closed')
    expect(outcomeOf({ status: 'closed', converted_at: null, lost_reason: null })).toBe('closed')
  })

  it('prefers won when both markers are somehow set', () => {
    // Only reachable through an edit that changed its mind. A recorded
    // conversion is a stronger claim than a reason left in a box.
    expect(
      outcomeOf({ status: 'closed', converted_at: '2026-09-20', lost_reason: 'Budget' }),
    ).toBe('won')
  })
})
