/**
 * Who engaged with your broadcasts lately — an audience ("Engagement" in
 * New broadcast) and a segment rule (src/lib/segments/filter.ts).
 *
 *   replied     replied to a broadcast in the last N days
 *   read        opened one (read or replied) in the last N days
 *   ignored     got broadcasts in the last N days and replied to none
 *   not_sent    got no broadcast at all in the last N days (rested)
 *
 * Counted from broadcast recipients, inside the account.
 */

import type { Prisma } from '@prisma/client'

export const ENGAGEMENT_KINDS = ['replied', 'read', 'ignored', 'not_sent'] as const
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number]

export const ENGAGEMENT_LABEL: Record<EngagementKind, string> = {
  replied: 'Replied to a broadcast',
  read: 'Opened a broadcast',
  ignored: 'Got broadcasts but never replied',
  not_sent: 'Got no broadcast',
}

export function isEngagementKind(v: unknown): v is EngagementKind {
  return typeof v === 'string' && (ENGAGEMENT_KINDS as readonly string[]).includes(v)
}

/** 1–365 days, or null for anything else. */
export function engagementDays(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null
}

export function engagementWhere(accountId: string, kind: EngagementKind, days: number, now: Date = new Date()): Prisma.ContactWhereInput {
  const since = new Date(now.getTime() - days * 86_400_000)
  const ours = { broadcast: { account_id: accountId } }
  const gotOne: Prisma.BroadcastRecipientWhereInput = { ...ours, sent_at: { gte: since } }
  switch (kind) {
    case 'replied':
      return { broadcast_recipients: { some: { ...ours, status: 'replied', replied_at: { gte: since } } } }
    case 'read':
      return { broadcast_recipients: { some: { ...ours, status: { in: ['read', 'replied'] }, sent_at: { gte: since } } } }
    case 'ignored':
      return {
        AND: [
          { broadcast_recipients: { some: { ...gotOne, status: { in: ['sent', 'delivered', 'read'] } } } },
          { broadcast_recipients: { none: { ...gotOne, status: 'replied' } } },
        ],
      }
    case 'not_sent':
      return { broadcast_recipients: { none: gotOne } }
  }
}
