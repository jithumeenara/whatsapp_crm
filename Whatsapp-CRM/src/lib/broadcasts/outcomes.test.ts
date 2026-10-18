import { describe, expect, it } from 'vitest'
import { OUTCOMES, OUTCOME_INFO, countOutcomes, outcomeOf } from './outcomes'

describe('what happened to each recipient', () => {
  it('puts every status in exactly one group', () => {
    expect(outcomeOf({ status: 'replied' })).toBe('replied')
    expect(outcomeOf({ status: 'read' })).toBe('read_no_reply')
    expect(outcomeOf({ status: 'delivered' })).toBe('not_opened')
    expect(outcomeOf({ status: 'sent' })).toBe('not_delivered_yet')
    expect(outcomeOf({ status: 'pending' })).toBe('waiting')
  })

  it('sorts failures by what can be done', () => {
    expect(outcomeOf({ status: 'failed', error_message: 'Opted out (code 131050)' })).toBe('opted_out')
    expect(outcomeOf({ status: 'failed', error_message: 'Not a WhatsApp user (code 131026)' })).toBe('cannot_receive')
    expect(outcomeOf({ status: 'failed', error_message: 'Invalid phone number format' })).toBe('cannot_receive')
    expect(outcomeOf({ status: 'failed', error_message: 'Healthy ecosystem (code 131049)' })).toBe('not_delivered')
    expect(outcomeOf({ status: 'failed', error_message: 'Template paused (code 132015)' })).toBe('not_delivered')
    expect(outcomeOf({ status: 'failed', error_message: null })).toBe('not_delivered')
  })

  it('never offers a follow-up to people who cannot or must not get one', () => {
    expect(OUTCOME_INFO.opted_out.followUp).toBe(false)
    expect(OUTCOME_INFO.cannot_receive.followUp).toBe(false)
    expect(OUTCOME_INFO.waiting.followUp).toBe(false)
    expect(OUTCOME_INFO.read_no_reply.followUp).toBe(true)
  })

  it('counts each group, with every group present', () => {
    const counts = countOutcomes([{ status: 'read' }, { status: 'read' }, { status: 'replied' }])
    expect(Object.keys(counts).sort()).toEqual([...OUTCOMES].sort())
    expect(counts.read_no_reply).toBe(2)
    expect(counts.replied).toBe(1)
    expect(counts.opted_out).toBe(0)
  })

  it('says plainly that "not opened" can mean hidden read receipts', () => {
    expect(OUTCOME_INFO.not_opened.means).toMatch(/read receipts/)
  })
})
