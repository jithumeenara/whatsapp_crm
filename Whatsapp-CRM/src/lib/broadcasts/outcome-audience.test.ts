import { describe, expect, it, vi } from 'vitest'
import { contactsInList, contactsInOutcome } from './outcome-audience'

function fakeDb(opts: { broadcastFound: boolean; listFound?: boolean }) {
  return {
    broadcast: { findFirst: vi.fn(async () => (opts.broadcastFound ? { id: 'b1' } : null)) },
    broadcastRecipient: {
      findMany: vi.fn(async () => [
        { contact_id: 'c1', status: 'read', error_message: null },
        { contact_id: 'c2', status: 'read', error_message: null },
        { contact_id: 'c2', status: 'read', error_message: null },
        { contact_id: 'c3', status: 'replied', error_message: null },
        { contact_id: 'c4', status: 'failed', error_message: 'Opted out (code 131050)' },
      ]),
    },
    contactList: { findFirst: vi.fn(async () => (opts.listFound ? { id: 'l1' } : null)) },
    contactListMember: { findMany: vi.fn(async () => [{ contact_id: 'c1' }, { contact_id: 'c9' }]) },
  }
}

describe('the people in one group of a broadcast', () => {
  it('looks the broadcast up inside the caller’s account only', async () => {
    const db = fakeDb({ broadcastFound: false })
    expect(await contactsInOutcome(db as never, 'acct-A', 'b-of-acct-B', 'read_no_reply')).toBeNull()
    expect(db.broadcast.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b-of-acct-B', account_id: 'acct-A' } }))
    expect(db.broadcastRecipient.findMany).not.toHaveBeenCalled()
  })

  it('returns each person in the group once', async () => {
    const db = fakeDb({ broadcastFound: true })
    expect(await contactsInOutcome(db as never, 'acct-A', 'b1', 'read_no_reply')).toEqual(['c1', 'c2'])
    expect(await contactsInOutcome(db as never, 'acct-A', 'b1', 'opted_out')).toEqual(['c4'])
  })

  it('refuses a group name it does not know', async () => {
    const db = fakeDb({ broadcastFound: true })
    expect(await contactsInOutcome(db as never, 'acct-A', 'b1', 'everyone' as never)).toBeNull()
  })
})

describe('the people in a saved list', () => {
  it('reads only a list of the caller’s account', async () => {
    const db = fakeDb({ broadcastFound: true, listFound: false })
    expect(await contactsInList(db as never, 'acct-A', 'l-of-acct-B')).toBeNull()
    expect(db.contactList.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l-of-acct-B', account_id: 'acct-A' } }))
    expect(db.contactListMember.findMany).not.toHaveBeenCalled()
  })

  it('returns the members of its own list', async () => {
    const db = fakeDb({ broadcastFound: true, listFound: true })
    expect(await contactsInList(db as never, 'acct-A', 'l1')).toEqual(['c1', 'c9'])
  })
})
