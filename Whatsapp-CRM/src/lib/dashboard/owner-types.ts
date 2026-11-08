/**
 * What the owner dashboard API returns (GET /api/dashboard/owner) and what
 * the Leads page "Tasks" tab reads (GET /api/my-tasks). One shape for both
 * screens: the server builds it, the screens only draw it.
 *
 * Every figure here comes from the Reports engine (lib/reports/summary.ts)
 * or from lib/leads/my-tasks.ts, never from a second formula: the same
 * word must not mean two numbers (docs/plans/dashboard-plan.md §3, §4).
 */

import type { AgentRow, Count, Money } from '@/lib/reports/summary'
import type { FunnelRow } from '@/lib/reports/funnel'

/**
 * Who is looking decides how much they see:
 *  - 'owner': owner and admin. Everything, money included.
 *  - 'team':  supervisor. The whole team's counts, no money.
 *  - 'agent': agent, viewer, and anybody whose profile is restricted to
 *             their own work. Their own numbers only.
 */
export type DashboardView = 'owner' | 'team' | 'agent'

export interface TaskItem {
  /** The follow-up's id, or the lead's id for a lead task. */
  id: string
  kind: 'follow_up' | 'lead'
  /** Where it opens: /leads/{leadId}. A follow-up with no lead opens nothing. */
  leadId: string | null
  title: string
  /** When it is due (ISO). Follow-ups only: a customer who said "call at 4:30" has a time. */
  dueAt: string | null
  /** The lead's status, for lead tasks. */
  status?: string
  /** Follow-ups: the title of the lead it belongs to, if any. */
  leadTitle?: string | null
  /** New leads: where it came from, and when it arrived (ISO). */
  source?: string | null
  createdAt?: string
}

export interface TaskGroup {
  /** The true count, even when `items` is cut to the first few. */
  count: number
  items: TaskItem[]
}

/**
 * One person's Task list (the user's definition, 8 Nov 2026):
 *  - overdue:  pending follow-ups whose time has passed (due_at < now).
 *  - dueToday: pending follow-ups due today, in time order. These are the
 *              dates set after a call ("call me tomorrow", "at 4:30").
 *  - newLeads: leads still 'new' that are mine: assigned to me by a
 *              manager or admin, picked by me, or made by hand by me.
 *  - pendingLeads / pendingFollowUps: counted separately, never added.
 *  - todayTotal: dueToday.count + newLeads.count.
 */
export interface MyTasks {
  overdue: TaskGroup
  dueToday: TaskGroup
  newLeads: TaskGroup
  pendingLeads: number
  pendingFollowUps: number
  todayTotal: number
}

/** The same counts for the whole team, for supervisors and above. */
export interface TeamTasks {
  overdue: number
  dueToday: number
  newLeads: number
  pendingLeads: number
  pendingFollowUps: number
}

/** What needs a person right now. */
export interface Attention {
  overdueFollowUps: number
  /** Chats with a customer message nobody has answered for `leakHours`. */
  waitingChats: number
  /** Open leads older than `leakHours` that nobody has contacted. */
  neverContacted: number
  /** Null for a person looking at their own work only. */
  unassigned: number | null
  /** Null when the calls cannot be tied to this person: "0" would be a false comfort. */
  missedCallsToday: number | null
  leakHours: number
  /** ISO time of the oldest unanswered customer message, or null. */
  oldestWaitingChatSince: string | null
}

export interface Kpis {
  /** Leads that came in this period, and what became of them. */
  cohort: Count
  previousCohort: Count
  wonInPeriod: number
  previousWonInPeriod: number
  /** Null for anybody who may not see money. */
  revenue: Money[] | null
  previousRevenue: Money[] | null
  pipeline: Money[] | null
  /** Median minutes from a lead arriving to the first reply by a person. */
  medianFirstReplyMinutes: number | null
  previousMedianFirstReplyMinutes: number | null
}

export interface FollowUpBuckets {
  overdue: number
  dueToday: number
  next7Days: number
}

export interface OwnerDashboard {
  generatedAt: string
  view: DashboardView
  /** Whether the money fields are filled for this viewer. */
  money: boolean
  period: {
    kind: 'today' | 'week' | 'month'
    firstDay: string
    lastDay: string
    /** The period is not over yet, so the comparison uses the same days of the one before. */
    partial: boolean
    timeZone: string
  }
  attention: Attention
  kpis: Kpis
  funnel: FunnelRow[]
  bySource: Array<{ source: string } & Count>
  followUps: FollowUpBuckets
  /** Supervisors and above only. */
  team: AgentRow[] | null
  /** The viewer's own Task list. */
  tasks: MyTasks
  /** Supervisors and above only. */
  teamTasks: TeamTasks | null
  /** Percentages on fewer leads than this are shown faded (Reports rule 7). */
  smallNumber: number
}
