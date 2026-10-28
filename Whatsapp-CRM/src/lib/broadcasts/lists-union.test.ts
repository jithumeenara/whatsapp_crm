import { describe, expect, it, vi } from 'vitest'
import { contactsInLists } from './outcome-audience'

function fakeDb(ownLists: string[]) {
  return {
    contactList: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; account_id: string } }) =>
        args.where.id.in.filter((id) => ownLists.includes(id)).map((id) => ({ id }))),
    },
    contactListMember: {
      findMany: vi.fn(async (args: { where: { list_id: { in: string[] } } }) => {
        const members: Record<string, string[]> = { l1: ['c1', 'c2'], l2: ['c2', 'c3'], lB: ['c99'] }
        return args.where.list_id.in.flatMap((l) => (members[l] ?? []).map((contact_id) => ({ contact_id })))
      }),
    },
  }
}

describe('the people in several saved lists', () => {
  it('everyone in any of them, each person once', async () => {
    const db = fakeDb(['l1', 'l2'])
    expect(await contactsInLists(db as never, 'acct-A', ['l1', 'l2'])).toEqual(['c1', 'c2', 'c3'])
    expect(db.contactList.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['l1', 'l2'] }, account_id: 'acct-A' } }))
  })

  it('a list of another account adds nobody', async () => {
    const db = fakeDb(['l1'])
    expect(await contactsInLists(db as never, 'acct-A', ['l1', 'lB'])).toEqual(['c1', 'c2'])
    expect(await contactsInLists(fakeDb([]) as never, 'acct-A', ['lB'])).toBeNull()
    expect(await contactsInLists(fakeDb(['l1']) as never, 'acct-A', [])).toBeNull()
  })
})
