// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}


export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
  /** Second line: a short preview of the message, and so on. Only sent
   *  to supervisors and above — see loadActivity. */
  detail?: string
}

/** One figure per day, oldest first, for the small trend line on each
 *  headline card. */
export interface Sparks {
  days: string[]
  conversations: number[]
  newContacts: number[]
  messagesSent: number[]
  hotLeads: number[]
}

export interface LeadStatusCount {
  status: string
  count: number
}

export interface CRMStats {
  leadsByStatus: LeadStatusCount[]
  totalLeads: number
  hotLeads: number
  pendingFollowUps: number
  overdueFollowUps: number
  pendingTasks: number
  overdueTasks: number
  /** People in this account who can work conversations. */
  teamMembers: number
}
