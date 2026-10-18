import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (18 Oct 2026): after "Merge contacts", the absorbed contact keeps
 * its phone number, and findExistingContact did not look at
 * merged_into_contact_id — so the next WhatsApp message from that number
 * was filed on the hidden, merged contact instead of the one kept.
 */

const h = vi.hoisted(() => ({
  contacts: [] as Array<{ id: string; account_id: string; phone: string; merged_into_contact_id: string | null }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findMany: (a: { where: { account_id: string; phone: { endsWith: string } } }) =>
        Promise.resolve(h.contacts.filter((c) => c.account_id === a.where.account_id && c.phone.endsWith(a.where.phone.endsWith))),
      findFirst: (a: { where: { id: string; account_id: string } }) =>
        Promise.resolve(h.contacts.find((c) => c.id === a.where.id && c.account_id === a.where.account_id) ?? null),
    },
  },
}))

import { findExistingContact } from './dedupe'

beforeEach(() => {
  h.contacts = [
    { id: 'kept', account_id: 'acc', phone: 'email:anu@example.com', merged_into_contact_id: null },
    { id: 'absorbed', account_id: 'acc', phone: '+919495043668', merged_into_contact_id: 'kept' },
  ]
})

describe('a message from a merged contact’s number', () => {
  it('is filed on the contact that was kept', async () => {
    const found = await findExistingContact('acc', '919495043668')
    expect(found?.id).toBe('kept')
  })

  it('follows a chain of merges', async () => {
    h.contacts.push({ id: 'kept2', account_id: 'acc', phone: 'web:x', merged_into_contact_id: null })
    h.contacts[0].merged_into_contact_id = 'kept2'
    const found = await findExistingContact('acc', '919495043668')
    expect(found?.id).toBe('kept2')
  })

  it('an ordinary contact is found as before', async () => {
    h.contacts = [{ id: 'c1', account_id: 'acc', phone: '+919495043668', merged_into_contact_id: null }]
    expect((await findExistingContact('acc', '9495043668'))?.id).toBe('c1')
  })
})
