import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Adding a tag, from anywhere, is one event. Found 18 Oct: the Automations
 * builder offered a "Tag added" trigger that nothing ever fired — tags were
 * added in five places and none of them told the automations. And a tag id
 * from a request was linked without checking it belonged to the account.
 */

const h = vi.hoisted(() => ({
  tags: [
    { id: 'vip', account_id: 'acc' },
    { id: 'cold', account_id: 'acc' },
    { id: 'theirs', account_id: 'other' },
  ],
  links: [] as Array<{ contact_id: string; tag_id: string }>,
  fired: [] as Array<{ triggerType: string; contactId: string; context: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    tag: {
      findMany: (a: { where: { id: { in: string[] }; account_id: string } }) =>
        Promise.resolve(h.tags.filter((t) => a.where.id.in.includes(t.id) && t.account_id === a.where.account_id).map((t) => ({ id: t.id }))),
    },
    contactTag: {
      findMany: (a: { where: { contact_id: { in: string[] } | string; tag_id: { in: string[] } } }) => {
        const contacts = typeof a.where.contact_id === 'string' ? [a.where.contact_id] : a.where.contact_id.in
        return Promise.resolve(h.links.filter((l) => contacts.includes(l.contact_id) && a.where.tag_id.in.includes(l.tag_id)))
      },
      createMany: (a: { data: Array<{ contact_id: string; tag_id: string }> }) => {
        h.links.push(...a.data)
        return Promise.resolve({ count: a.data.length })
      },
    },
  },
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: (input: { triggerType: string; contactId: string; context: Record<string, unknown> }) => {
    h.fired.push(input)
    return Promise.resolve({ matched: 1 })
  },
}))

import { addTagsToContact, addTagsToContacts } from './tag-events'

beforeEach(() => {
  h.links = []
  h.fired = []
})

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('adding tags', () => {
  it('fires "Tag added" once for each tag that is new on the contact', async () => {
    h.links = [{ contact_id: 'c1', tag_id: 'cold' }]
    const added = await addTagsToContact({ accountId: 'acc', contactId: 'c1', tagIds: ['vip', 'cold'], source: 'inbox' })
    await settle()
    expect(added).toEqual(['vip'])
    expect(h.fired).toEqual([
      { accountId: 'acc', triggerType: 'tag_added', contactId: 'c1', context: { tag_id: 'vip', tag_source: 'inbox', tag_hop: 1 } },
    ])
  })

  it('never links another account\'s tag', async () => {
    const added = await addTagsToContact({ accountId: 'acc', contactId: 'c1', tagIds: ['theirs'], source: 'api' })
    expect(added).toEqual([])
    expect(h.links).toEqual([])
    expect(h.fired).toEqual([])
  })

  it('stops a chain of automations that keep adding tags', async () => {
    await addTagsToContact({ accountId: 'acc', contactId: 'c1', tagIds: ['vip'], source: 'automation', hop: 3 })
    await settle()
    expect(h.links).toHaveLength(1)
    expect(h.fired).toEqual([])
  })

  it('tags many contacts at once and fires for each new pair', async () => {
    h.links = [{ contact_id: 'c2', tag_id: 'vip' }]
    await addTagsToContacts({ accountId: 'acc', pairs: [{ contactId: 'c1', tagId: 'vip' }, { contactId: 'c2', tagId: 'vip' }], source: 'import' })
    await settle()
    expect(h.fired.map((f) => f.contactId)).toEqual(['c1'])
  })
})
