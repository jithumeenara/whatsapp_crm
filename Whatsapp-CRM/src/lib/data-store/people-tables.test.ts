import { describe, it, expect } from 'vitest'
import { looksLikeContactList } from './people-tables'

// Invented numbers and names only.
const PARTICIPANTS = [
  'Sub staff training programme list',
  ...[1, 2, 3, 4, 5].map(
    (n) => `Sl No.: ${n} | Name of participant: Person ${n} | Designation: Clerk | WhatsApp No.: 98000 0000${n}`,
  ),
].join('\n\n')

const CALENDAR = [
  'TABLE: Training',
  'Name of programme: Statutory Training Programme (STP) (S)\nCoordinator: A Coordinator\nCoordinator mobile no: 9800011111\nFee: 3540',
  'Name of programme: Gold loan Appraisal\nCoordinator: A Coordinator\nCoordinator mobile no: 9800011111\nFee: 2360',
  'Name of programme: Leadership\nCoordinator: B Coordinator\nCoordinator mobile no: +91 98000 22222\nFee: 5900',
].join('\n\n')

describe('a sheet or table that is a list of people', () => {
  it('is recognised by one phone number per row', () => {
    expect(looksLikeContactList(PARTICIPANTS)).toBe(true)
  })

  it('is recognised by email addresses too', () => {
    const emails = [1, 2, 3, 4, 5].map((n) => `Student ${n}: student${n}@example.com`).join('\n')
    expect(looksLikeContactList(emails)).toBe(true)
  })

  it('does not catch a calendar with a coordinator or two', () => {
    expect(looksLikeContactList(CALENDAR)).toBe(false)
  })

  it('counts the same number written two ways once', () => {
    const same = ['9800011111', '+91 98000 11111', '098000-11111', '98000 11111'].join('\n')
    expect(looksLikeContactList(same)).toBe(false)
  })

  it('ignores fees, dates and account numbers', () => {
    const money = 'Fee: 3540\nDate: 2026-10-12\nIFSC: SBIN0001234\nA/c: 12345678901234\nPin: 695583'
    expect(looksLikeContactList(money)).toBe(false)
    expect(looksLikeContactList(null)).toBe(false)
  })
})
