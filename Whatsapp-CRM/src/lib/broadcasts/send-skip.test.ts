import { describe, expect, it } from 'vitest'
import { skipReason } from './send-skip'
import { outcomeOf } from './outcomes'

const ok = { phone: '+919000000001', opt_in_status: 'opted_in', blocked_at: null, merged_into_contact_id: null }

describe('who is left out when a broadcast finally goes', () => {
  it('sends to someone still reachable', () => {
    expect(skipReason({ contact: ok, repliedToParent: false, parentOutcome: null })).toBeNull()
  })

  it('leaves out someone who opted out, was blocked or merged after it was set up', () => {
    expect(skipReason({ contact: { ...ok, opt_in_status: 'opted_out' }, repliedToParent: false, parentOutcome: null })).toMatch(/no more messages/)
    expect(skipReason({ contact: { ...ok, blocked_at: new Date() }, repliedToParent: false, parentOutcome: null })).toMatch(/blocked/)
    expect(skipReason({ contact: { ...ok, merged_into_contact_id: 'x' }, repliedToParent: false, parentOutcome: null })).toMatch(/merged/)
  })

  it('does not remind people who answered the first message', () => {
    expect(skipReason({ contact: ok, repliedToParent: true, parentOutcome: 'read_no_reply' })).toMatch(/replied/)
    expect(skipReason({ contact: ok, repliedToParent: true, parentOutcome: 'not_opened' })).toMatch(/replied/)
  })

  it('still sends a thank-you follow-up to the people who replied', () => {
    expect(skipReason({ contact: ok, repliedToParent: true, parentOutcome: 'replied' })).toBeNull()
  })

  it('shows a left-out person in their own group, never as a failure', () => {
    expect(outcomeOf({ status: 'skipped', error_message: 'Left out: replied to the first message' })).toBe('skipped')
  })
})
