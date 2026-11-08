/**
 * What the notification bell shows: the things waiting for this person
 * right now, as live counts. Nothing is stored; each number is the same
 * one the dashboard and the Leads → Tasks tab show (lib/leads/my-tasks.ts),
 * so the bell can never disagree with the screen it opens.
 */
import { canOpenPath } from '@/lib/auth/page-access'
import type { AccountRole } from '@/lib/auth/roles'
import { missedCallsToday } from '@/lib/dashboard/owner'
import { resolveDashboardScope } from '@/lib/dashboard/scope'
import { loadMyTasks } from '@/lib/leads/my-tasks'

export type BellKey = 'overdue' | 'today' | 'new' | 'missed'

export interface BellItem {
  key: BellKey
  label: string
  count: number
  /** The list behind the number. */
  href: string
}

export interface Bell {
  items: BellItem[]
  /** What the badge shows: the sum of the counts. */
  total: number
}

/** Which page a person must be allowed to open to see each item. The
 *  follow-up lists belong to the lead work, as in GET /api/my-tasks. */
const GATE: Record<BellKey, string> = {
  overdue: '/leads',
  today: '/leads',
  new: '/leads',
  missed: '/calls',
}

export async function loadBell(a: {
  accountId: string
  userId: string
  role: AccountRole | string
  pageAccess: unknown
  tz: string
  now: Date
}): Promise<Bell> {
  const role = a.role as AccountRole
  const may = (k: BellKey) => canOpenPath(role, a.pageAccess, GATE[k])
  const scope = await resolveDashboardScope({ userId: a.userId, role })
  // A missed call has nobody on it, so only people who see the whole team get it.
  const wantMissed = scope.view !== 'agent' && may('missed')
  const wantTasks = may('overdue')

  const [tasks, missed] = await Promise.all([
    wantTasks ? loadMyTasks({ accountId: a.accountId, userId: a.userId, tz: a.tz, now: a.now, limit: 1, only: 'overdue' }) : Promise.resolve(null),
    wantMissed ? missedCallsToday(a.accountId, a.tz, a.now) : Promise.resolve(null),
  ])

  const items: BellItem[] = []
  if (tasks) {
    items.push(
      { key: 'overdue', label: 'Overdue follow-ups', count: tasks.overdue.count, href: '/follow-ups?due=overdue&mine=1' },
      { key: 'today', label: 'Follow-ups due today', count: tasks.dueToday.count, href: '/follow-ups?due=today&mine=1' },
      { key: 'new', label: 'New leads for you', count: tasks.newLeads.count, href: '/leads?tab=tasks&group=new' },
    )
  }
  if (missed !== null) {
    items.push({ key: 'missed', label: 'Missed or declined calls today', count: missed, href: '/calls?status=missed&day=today' })
  }
  return { items, total: items.reduce((n, i) => n + i.count, 0) }
}
