/**
 * "My tasks": the one place that decides what counts as overdue, due today,
 * a new lead of mine, and so on (product owner's definitions, 8 Nov 2026).
 * The owner dashboard and the Leads page Tasks tab both read this.
 *
 *  - Mine (follow-up): pending and assigned to me. A follow-up saved with no
 *    assignee (POST /api/follow-ups stores assigned_to NULL and user_id = the
 *    creator) is also mine when I made it.
 *  - overdue: pending, due_at < now (an instant, the same rule as Reports'
 *    leaks.overdueFollowUps). dueToday: now <= due_at < start of tomorrow in
 *    the business zone. next7: tomorrow onward, seven business days.
 *  - Mine (lead): assigned to me (given by a manager, or picked from the pool,
 *    both set assigned_to), or no holder and made by hand by me. Automation
 *    (Facebook, flows, AI, webhook, admin chat) saves user_id = the owner or a
 *    system user, so only the source 'manual' means "a person made this".
 *  - newLeads: status 'new'. pendingLeads: anything but 'closed'. Hidden and
 *    AI-suggested leads are never work. The counts are never added together.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { zonedDaysAgoStart } from '@/lib/dashboard/date-utils'
import type { FollowUpBuckets, MyTasks, TaskGroup, TaskItem, TeamTasks } from '@/lib/dashboard/owner-types'

export const DEFAULT_ITEMS = 8
export const MAX_ITEMS = 50
/** What one list may return when only that list is asked for. */
export const MAX_ITEMS_ONE_GROUP = 200
/** The only lead source that means "a person typed this lead in". */
export const MANUAL_SOURCE = 'manual'

const clamp = (limit: number | undefined, cap = MAX_ITEMS) => Math.min(Math.max(Math.floor(limit ?? DEFAULT_ITEMS) || DEFAULT_ITEMS, 1), cap)

const mineFollowUps = (accountId: string, userId: string): Prisma.FollowUpWhereInput => ({
  account_id: accountId,
  status: 'pending',
  OR: [{ assigned_to: userId }, { assigned_to: null, user_id: userId }],
})

const allFollowUps = (accountId: string): Prisma.FollowUpWhereInput => ({ account_id: accountId, status: 'pending' })

const leadBase = (accountId: string): Prisma.LeadWhereInput => ({ account_id: accountId, is_hidden: false, ai_suggested: false })

const mineLeads = (accountId: string, userId: string): Prisma.LeadWhereInput => ({
  ...leadBase(accountId),
  OR: [{ assigned_to: userId }, { assigned_to: null, user_id: userId, source: { equals: MANUAL_SOURCE, mode: 'insensitive' } }],
})

const NEW = { status: 'new' } as const
const OPEN = { status: { not: 'closed' } } as const

export type FollowUpWindowKind = 'overdue' | 'today' | 'next7'

/**
 * The one definition of the follow-up windows, as a due_at condition.
 * overdue: before now (an instant, as Reports' leak count). today: now up to
 * the start of tomorrow in the business zone. next7: from the start of
 * tomorrow to the start of the 8th day from today. The three never overlap.
 */
export function followUpWindow(kind: FollowUpWindowKind, now: Date, tz: string): Prisma.DateTimeFilter {
  if (kind === 'overdue') return { lt: now }
  const tomorrow = zonedDaysAgoStart(-1, tz, now)
  if (kind === 'today') return { gte: now, lt: tomorrow }
  return { gte: tomorrow, lt: zonedDaysAgoStart(-8, tz, now) }
}

type Buckets = { overdue: Prisma.FollowUpWhereInput; today: Prisma.FollowUpWhereInput; next7: Prisma.FollowUpWhereInput }
function buckets(base: Prisma.FollowUpWhereInput, tz: string, now: Date): Buckets {
  return {
    overdue: { ...base, due_at: followUpWindow('overdue', now, tz) },
    today: { ...base, due_at: followUpWindow('today', now, tz) },
    next7: { ...base, due_at: followUpWindow('next7', now, tz) },
  }
}

async function followUpGroup(where: Prisma.FollowUpWhereInput, take: number): Promise<TaskGroup> {
  // take 0: the caller wants the count only, so no rows are fetched.
  const [count, rows] = await Promise.all([
    prisma.followUp.count({ where }),
    take === 0 ? Promise.resolve([]) : prisma.followUp.findMany({ where, orderBy: { due_at: 'asc' }, take, select: { id: true, lead_id: true, title: true, due_at: true, lead: { select: { title: true } } } }),
  ])
  const items: TaskItem[] = rows.map((r) => ({ id: r.id, kind: 'follow_up', leadId: r.lead_id ?? null, title: r.title, dueAt: r.due_at.toISOString(), leadTitle: r.lead?.title ?? null }))
  return { count, items }
}

async function leadGroup(where: Prisma.LeadWhereInput, take: number): Promise<TaskGroup> {
  const [count, rows] = await Promise.all([
    prisma.lead.count({ where }),
    take === 0 ? Promise.resolve([]) : prisma.lead.findMany({ where, orderBy: { created_at: 'asc' }, take, select: { id: true, title: true, status: true, source: true, created_at: true } }),
  ])
  const items: TaskItem[] = rows.map((r) => ({ id: r.id, kind: 'lead', leadId: r.id, title: r.title, dueAt: null, status: r.status, source: r.source ?? null, createdAt: r.created_at.toISOString() }))
  return { count, items }
}

/** One person's Task list. Everything is filtered to the account and to them. */
export async function loadMyTasks(args: { accountId: string; userId: string; tz: string; now: Date; limit?: number; cap?: number; only?: 'overdue' | 'today' | 'new' }): Promise<MyTasks> {
  const take = clamp(args.limit, Math.min(args.cap ?? MAX_ITEMS, MAX_ITEMS_ONE_GROUP))
  const base = mineFollowUps(args.accountId, args.userId)
  const b = buckets(base, args.tz, args.now)
  const leads = mineLeads(args.accountId, args.userId)
  const [overdue, dueToday, newLeads, pendingLeads, pendingFollowUps] = await Promise.all([
    followUpGroup(b.overdue, !args.only || args.only === 'overdue' ? take : 0),
    followUpGroup(b.today, !args.only || args.only === 'today' ? take : 0),
    leadGroup({ ...leads, ...NEW }, !args.only || args.only === 'new' ? take : 0),
    prisma.lead.count({ where: { ...leads, ...OPEN } }),
    prisma.followUp.count({ where: base }),
  ])
  return { overdue, dueToday, newLeads, pendingLeads, pendingFollowUps, todayTotal: dueToday.count + newLeads.count }
}

/** The same counts across every member, for supervisors and above. */
export async function loadTeamTasks(args: { accountId: string; tz: string; now: Date }): Promise<TeamTasks> {
  const b = buckets(allFollowUps(args.accountId), args.tz, args.now)
  // Unassigned pool leads are Attention.unassigned, not any person's task.
  const held = { ...leadBase(args.accountId), assigned_to: { not: null } } satisfies Prisma.LeadWhereInput
  const [overdue, dueToday, pendingFollowUps, newLeads, pendingLeads] = await Promise.all([
    prisma.followUp.count({ where: b.overdue }),
    prisma.followUp.count({ where: b.today }),
    prisma.followUp.count({ where: allFollowUps(args.accountId) }),
    prisma.lead.count({ where: { ...held, ...NEW } }),
    prisma.lead.count({ where: { ...held, ...OPEN } }),
  ])
  return { overdue, dueToday, newLeads, pendingLeads, pendingFollowUps }
}

/**
 * Overdue / today / next 7 days. `userId` null counts every pending
 * follow-up in the account (owner and supervisor views).
 */
export async function loadFollowUpBuckets(args: { accountId: string; userId: string | null; tz: string; now: Date }): Promise<FollowUpBuckets> {
  const base = args.userId ? mineFollowUps(args.accountId, args.userId) : allFollowUps(args.accountId)
  const b = buckets(base, args.tz, args.now)
  const [overdue, dueToday, next7Days] = await Promise.all([
    prisma.followUp.count({ where: b.overdue }),
    prisma.followUp.count({ where: b.today }),
    prisma.followUp.count({ where: b.next7 }),
  ])
  return { overdue, dueToday, next7Days }
}
