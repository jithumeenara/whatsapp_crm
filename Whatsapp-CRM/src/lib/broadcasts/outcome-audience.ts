/**
 * Audiences that are a fixed set of people rather than a filter:
 *   - one group of a broadcast's recipients ("Read, no reply", …) — a
 *     follow-up's audience and the source of "Save as list";
 *   - a saved contact list.
 * Always inside the caller's account: an id from a request is never enough.
 */

import type { PrismaClient } from '@prisma/client'
import { isOutcome, outcomeOf, type Outcome } from './outcomes'

type Db = Pick<PrismaClient, 'broadcast' | 'broadcastRecipient' | 'contactList' | 'contactListMember'>

export async function contactsInOutcome(
  db: Db,
  accountId: string,
  broadcastId: string,
  outcome: Outcome,
): Promise<string[] | null> {
  if (!isOutcome(outcome)) return null
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId, account_id: accountId }, select: { id: true } })
  if (!broadcast) return null
  const rows = await db.broadcastRecipient.findMany({
    where: { broadcast_id: broadcast.id },
    select: { contact_id: true, status: true, error_message: true },
  })
  return [...new Set(rows.filter((r) => outcomeOf(r) === outcome).map((r) => r.contact_id))]
}

/**
 * Everyone in these saved lists, each person once. Lists of another
 * account are skipped; null when none of them is this account's.
 */
export async function contactsInLists(db: Db, accountId: string, listIds: readonly string[]): Promise<string[] | null> {
  if (listIds.length === 0) return null
  const lists = await db.contactList.findMany({ where: { id: { in: [...listIds] }, account_id: accountId }, select: { id: true } })
  if (lists.length === 0) return null
  const rows = await db.contactListMember.findMany({ where: { list_id: { in: lists.map((l) => l.id) } }, select: { contact_id: true } })
  return [...new Set(rows.map((r) => r.contact_id))]
}

export async function contactsInList(db: Db, accountId: string, listId: string): Promise<string[] | null> {
  if (typeof listId !== 'string' || !listId) return null
  const list = await db.contactList.findFirst({ where: { id: listId, account_id: accountId }, select: { id: true } })
  if (!list) return null
  const rows = await db.contactListMember.findMany({ where: { list_id: list.id }, select: { contact_id: true } })
  return rows.map((r) => r.contact_id)
}
