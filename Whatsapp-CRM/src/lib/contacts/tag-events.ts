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
 *
 * Removing works the same way (removeTagsFromContact) and fires "Tag
 * removed". Both also feed event-based broadcasts (src/lib/broadcasts/events.ts).
 */

import { prisma } from '@/lib/db'

export type TagSource = 'inbox' | 'api' | 'chatbot' | 'automation' | 'import' | 'ad_lead' | 'broadcast' | 'system' | 'admin_chat'

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
    for (const p of fresh) fireTagEvent('tag_added', args.accountId, p.contactId, p.tagId, args.source, hop)
  } else {
    console.warn(`[tags] not firing "Tag added" (${fresh.length}) — ${MAX_TAG_HOPS} automation hops in a row`)
  }
  fireEventBroadcasts('tag_added', args.accountId, fresh)
  return fresh.map((p) => p.tagId)
}

/**
 * Takes tags off a contact: either the named ones, or every tag except
 * `keepTagIds` (the Inbox's "set the tags to exactly these"). Only this
 * account's tags; returns the tag ids actually removed, each of which fires
 * "Tag removed".
 */
export async function removeTagsFromContact(args: {
  accountId: string
  contactId: string
  tagIds?: readonly string[]
  keepTagIds?: readonly string[]
  source: TagSource
  hop?: number
}): Promise<string[]> {
  if (!args.tagIds && !args.keepTagIds) return []
  const links = await prisma.contactTag.findMany({
    where: {
      contact_id: args.contactId,
      tag: { account_id: args.accountId },
      ...(args.tagIds ? { tag_id: { in: [...args.tagIds] } } : { tag_id: { notIn: [...(args.keepTagIds ?? [])] } }),
    },
    select: { tag_id: true },
  })
  if (links.length === 0) return []
  const removed = links.map((l) => l.tag_id)
  // Conditional delete: when two requests race, only the rows still
  // there are removed, and only the request that removed them reports so.
  const r = await prisma.contactTag.deleteMany({ where: { contact_id: args.contactId, tag_id: { in: removed } } })
  if (r.count === 0) return []

  const hop = (args.hop ?? 0) + 1
  if (hop <= MAX_TAG_HOPS) {
    for (const tagId of removed) fireTagEvent('tag_removed', args.accountId, args.contactId, tagId, args.source, hop)
  }
  fireEventBroadcasts('tag_removed', args.accountId, removed.map((tagId) => ({ contactId: args.contactId, tagId })))
  return removed
}

function fireTagEvent(
  triggerType: 'tag_added' | 'tag_removed',
  accountId: string,
  contactId: string,
  tagId: string,
  source: TagSource,
  hop: number,
): void {
  // Loaded lazily: the automation engine itself adds tags through here.
  void import('@/lib/automations/engine')
    .then((m) =>
      m.runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId,
        context: { tag_id: tagId, tag_source: source, tag_hop: hop },
      }),
    )
    .catch((err) => console.error(`[tags] "${triggerType}" automations failed:`, err instanceof Error ? err.message : err))
}

function fireEventBroadcasts(
  event: 'tag_added' | 'tag_removed',
  accountId: string,
  pairs: ReadonlyArray<{ contactId: string; tagId: string }>,
): void {
  if (pairs.length === 0) return
  void import('@/lib/broadcasts/events')
    .then((m) => m.onTagEvent({ accountId, event, pairs }))
    .catch((err) => console.error(`[tags] event broadcasts for "${event}" failed:`, err instanceof Error ? err.message : err))
}
