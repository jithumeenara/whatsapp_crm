import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Taking a tag off is an event too: "Tag removed" automations and
 *  event-based broadcasts hear it, once, and only for this account's tags. */

const h = vi.hoisted(() => ({
  links: [] as Array<{ contact_id: string; tag_id: string; account_id: string }>,
  fired: [] as Array<{ triggerType: string; context: Record<string, unknown> }>,
  events: [] as Array<{ event: string; pairs: unknown[] }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    contactTag: {
      findMany: (a: { where: { contact_id: string; tag: { account_id: string }; tag_id: { in?: string[]; notIn?: string[] } } }) =>
        Promise.resolve(
          h.links
            .filter((l) => l.contact_id === a.where.contact_id && l.account_id === a.where.tag.account_id)
            .filter((l) => (a.where.tag_id.in ? a.where.tag_id.in.includes(l.tag_id) : !(a.where.tag_id.notIn ?? []).includes(l.tag_id)))
            .map((l) => ({ tag_id: l.tag_id })),
        ),
      deleteMany: (a: { where: { contact_id: string; tag_id: { in: string[] } } }) => {
        const before = h.links.length
        h.links = h.links.filter((l) => !(l.contact_id === a.where.contact_id && a.where.tag_id.in.includes(l.tag_id)))
        return Promise.resolve({ count: before - h.links.length })
      },
    },
  },
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: (input: { triggerType: string; context: Record<string, unknown> }) => {
    h.fired.push(input)
    return Promise.resolve({ matched: 1 })
  },
}))
vi.mock('@/lib/broadcasts/events', () => ({
  onTagEvent: (a: { event: string; pairs: unknown[] }) => {
    h.events.push(a)
    return Promise.resolve({ queued: 0, calledOff: 0 })
  },
}))

import { removeTagsFromContact } from './tag-events'

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.links = [
    { contact_id: 'c1', tag_id: 'vip', account_id: 'acc' },
    { contact_id: 'c1', tag_id: 'cold', account_id: 'acc' },
    { contact_id: 'c1', tag_id: 'theirs', account_id: 'other' },
  ]
  h.fired = []
  h.events = []
})

describe('removing tags', () => {
  it('fires "Tag removed" once for each tag actually taken off', async () => {
    const removed = await removeTagsFromContact({ accountId: 'acc', contactId: 'c1', tagIds: ['vip', 'not-there'], source: 'inbox' })
    await settle()
    expect(removed).toEqual(['vip'])
    expect(h.fired.map((f) => [f.triggerType, f.context.tag_id])).toEqual([['tag_removed', 'vip']])
    expect(h.events).toEqual([{ accountId: 'acc', event: 'tag_removed', pairs: [{ contactId: 'c1', tagId: 'vip' }] }])
  })

  it('"keep only these" removes the rest of this account’s tags, never another account’s', async () => {
    const removed = await removeTagsFromContact({ accountId: 'acc', contactId: 'c1', keepTagIds: ['cold'], source: 'inbox' })
    expect(removed).toEqual(['vip'])
    expect(h.links.map((l) => l.tag_id).sort()).toEqual(['cold', 'theirs'])
  })

  it('removing a tag that is not there fires nothing', async () => {
    await removeTagsFromContact({ accountId: 'acc', contactId: 'c1', tagIds: ['nope'], source: 'inbox' })
    await settle()
    expect(h.fired).toEqual([])
    expect(h.events).toEqual([])
  })
})
