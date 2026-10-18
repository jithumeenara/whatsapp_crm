import { describe, expect, it } from 'vitest'
import { isSendableContact, sendableContactWhere } from './sendable'

/**
 * Found 18 Oct: broadcasts were sent to contacts who had opted out, to
 * blocked contacts, to merged duplicates and to website visitors (whose
 * "phone" is a web:<id> placeholder) — only email placeholders were left out.
 */
describe('who may receive a broadcast', () => {
  const base = { phone: '919495043668', opt_in_status: 'unknown', blocked_at: null, merged_into_contact_id: null }

  it('an ordinary contact', () => {
    expect(isSendableContact(base)).toBe(true)
  })

  it('never someone who opted out', () => {
    expect(isSendableContact({ ...base, opt_in_status: 'opted_out' })).toBe(false)
  })

  it('never a blocked or merged contact', () => {
    expect(isSendableContact({ ...base, blocked_at: new Date() })).toBe(false)
    expect(isSendableContact({ ...base, merged_into_contact_id: 'other' })).toBe(false)
  })

  it('never a website visitor or an email-only contact', () => {
    expect(isSendableContact({ ...base, phone: 'web:abcdef' })).toBe(false)
    expect(isSendableContact({ ...base, phone: 'email:a@b.c' })).toBe(false)
  })

  it('the database filter applies the same rules, inside one account', () => {
    expect(sendableContactWhere('acc')).toEqual({
      account_id: 'acc',
      merged_into_contact_id: null,
      blocked_at: null,
      opt_in_status: { not: 'opted_out' },
      NOT: [{ phone: { startsWith: 'email:' } }, { phone: { startsWith: 'web:' } }],
    })
  })
})
