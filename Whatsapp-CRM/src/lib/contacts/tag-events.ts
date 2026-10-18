/**
 * Adding tags to contacts — the one way to do it.
 *
 * Tags used to be added in five places (Inbox, broadcast import, ad leads,
 * automations, chatbots), each writing contact_tags directly, and none of
 * them told the automations — so the builder's "Tag added" trigger never
 * fired. Worse, a tag id from a request was linked without checking that
 * the tag belonged to the account.
 *
 * Here: the tags are checked against the account, only tags that are new
 * on the contact are written, and each new one fires "Tag added" (in the
 * background — the caller never waits on an automation). A chain of
 * automations that add tags to each other stops after a few hops.
 */

import { prisma } from '@/lib/db'

export type TagSource = 'inbox' | 'api' | 'chatbot' | 'automation' | 'import' | 'ad_lead' | 'broadcast' | 'system'

/** An automation adding a tag that fires an automation adding a tag… */
export const MAX_TAG_HOPS = 3

export async function addTagsToContact(args: {
  accountId: string
  contactId: string
  tagIds: readonly string[]
  source: TagSource
  /** Events already in the chain that led here (0 for a person's action). */
  hop?: number
}): Promise<string[]> {
  return addTagsToContacts({
    accountId: args.accountId,
    pairs: args.tagIds.map((tagId) => ({ contactId: args.contactId, tagId })),
    source: args.source,
    hop: args.hop,
  })
}

/** Many contacts at once (imports). Returns the tag ids newly added, per
 *  contact flattened — for one contact, its new tags. */
export async function addTagsToContacts(args: {
  accountId: string
  pairs: ReadonlyArray<{ contactId: string; tagId: string }>
  source: TagSource
  hop?: number
}): Promise<string[]> {
  const pairs = args.pairs.filter((p) => p.contactId && p.tagId)
  if (pairs.length === 0) return []

  // Only this account's tags.
  const tagIds = [...new Set(pairs.map((p) => p.tagId))]
  const owned = new Set(
    (await prisma.tag.findMany({ where: { id: { in: tagIds }, account_id: args.accountId }, select: { id: true } })).map((t) => t.id),
  )
  const valid = pairs.filter((p) => owned.has(p.tagId))
  if (valid.length === 0) return []

  // Only links that do not exist yet are new events.
  const contactIds = [...new Set(valid.map((p) => p.contactId))]
  const existing = new Set(
    (
      await prisma.contactTag.findMany({
        where: { contact_id: { in: contactIds }, tag_id: { in: [...owned] } },
        select: { contact_id: true, tag_id: true },
      })
    ).map((l) => `${l.contact_id}:${l.tag_id}`),
  )
  const seen = new Set<string>()
  const fresh = valid.filter((p) => {
    const key = `${p.contactId}:${p.tagId}`
    if (existing.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length === 0) return []

  await prisma.contactTag.createMany({
    data: fresh.map((p) => ({ contact_id: p.contactId, tag_id: p.tagId })),
    skipDuplicates: true,
  })

  const hop = (args.hop ?? 0) + 1
  if (hop <= MAX_TAG_HOPS) {
    for (const p of fresh) fireTagAdded(args.accountId, p.contactId, p.tagId, args.source, hop)
  } else {
    console.warn(`[tags] not firing "Tag added" (${fresh.length}) — ${MAX_TAG_HOPS} automation hops in a row`)
  }
  return fresh.map((p) => p.tagId)
}

function fireTagAdded(accountId: string, contactId: string, tagId: string, source: TagSource, hop: number): void {
  // Loaded lazily: the automation engine itself adds tags through here.
  void import('@/lib/automations/engine')
    .then((m) =>
      m.runAutomationsForTrigger({
        accountId,
        triggerType: 'tag_added',
        contactId,
        context: { tag_id: tagId, tag_source: source, tag_hop: hop },
      }),
    )
    .catch((err) => console.error('[tags] "Tag added" automations failed:', err instanceof Error ? err.message : err))
}
