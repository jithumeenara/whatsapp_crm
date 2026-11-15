/**
 * Every report the Reports area offers, who may open it and how it is built
 * (docs/plans/reports-sections-plan.md §3, §5). The one place access is
 * decided, so the menu, the screen and every export agree.
 *
 * Who sees what:
 * - Supervisors and above see the team. Anyone else given the Reports page
 *   sees a report built from their own work only — decided here from the
 *   role, never from the request.
 * - Money reports (ads, spending, and the money cards on the All report) are
 *   for owners and admins; spending is open to supervisors, as before.
 * - Exports are for supervisors and above.
 */

import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import type { ReportDoc } from './types'
import type { ReportContext } from './reports/common'
import { allReport } from './reports/all'
import { leadReport } from './reports/leads'
import { agentReport } from './reports/agents'
import { salesReport } from './reports/sales'
import { spendingReport } from './reports/spending'
import { adReport } from './reports/ads'
import { guideReport } from './reports/guide'
import { campaignReport } from './reports/campaigns'

export type ReportGroup = 'overview' | 'topic' | 'analysis'
export type ExportFormat = 'pdf' | 'xlsx' | 'pptx'
/** A team member id in the address (?member=), checked before any lookup. */
export const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'pptx']

export interface ReportDef {
  key: string
  title: string
  group: ReportGroup
  path: string
  /** Lowest role that may open it at all. */
  minRole: AccountRole
  /** Below supervisor, the report shows the person's own numbers (else refused). */
  selfAllowed: boolean
  /** Owners and admins only (team money). */
  money: boolean
  tabs: Array<'report' | 'compare'>
  /** Opens as one person's report card: their own below supervisor, or
   *  ?member=<id> (a member of the same business) for supervisors. */
  memberCard?: boolean
  build: (c: ReportContext, o: { canSeeMoney: boolean }) => Promise<ReportDoc>
}

export const REPORTS: ReportDef[] = [
  { key: 'all', title: 'All report', group: 'overview', path: '/reports', minRole: 'viewer', selfAllowed: true, money: false, tabs: ['report'], build: (c, o) => allReport(c, o.canSeeMoney) },
  { key: 'leads', title: 'Lead report', group: 'topic', path: '/reports/leads', minRole: 'viewer', selfAllowed: true, money: false, tabs: ['report', 'compare'], build: (c) => leadReport(c) },
  { key: 'agents', title: 'Agent report', group: 'topic', path: '/reports/agents', minRole: 'viewer', selfAllowed: true, money: false, tabs: ['report', 'compare'], memberCard: true, build: (c) => agentReport(c) },
  { key: 'ads', title: 'Ad report', group: 'topic', path: '/reports/ads', minRole: 'admin', selfAllowed: false, money: true, tabs: ['report', 'compare'], build: (c) => adReport(c) },
  { key: 'sales', title: 'Sales & Pipeline', group: 'topic', path: '/reports/sales', minRole: 'viewer', selfAllowed: true, money: false, tabs: ['report', 'compare'], build: (c) => salesReport(c) },
  { key: 'spending', title: 'Spending & ROI', group: 'topic', path: '/reports/spending', minRole: 'supervisor', selfAllowed: false, money: false, tabs: ['report', 'compare'], build: (c) => spendingReport(c) },
  { key: 'campaigns', title: 'Campaign report', group: 'topic', path: '/reports/campaigns', minRole: 'supervisor', selfAllowed: false, money: false, tabs: ['report'], build: (c) => campaignReport(c) },
  { key: 'guide', title: 'Performance guide', group: 'analysis', path: '/reports/guide', minRole: 'viewer', selfAllowed: true, money: false, tabs: ['report'], build: (c, o) => guideReport(c, o.canSeeMoney) },
]

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key)
}

export interface Access {
  /** May open it. */
  allowed: boolean
  /** Whose numbers: null = team, else this user id. */
  userId: string | null
  canExport: boolean
  canSeeMoney: boolean
}

/** What this person may do with this report. Pure. */
export function accessFor(def: ReportDef, who: { userId: string; role: AccountRole }): Access {
  const team = hasMinRole(who.role, 'supervisor')
  const canSeeMoney = hasMinRole(who.role, 'admin')
  const no: Access = { allowed: false, userId: who.userId, canExport: false, canSeeMoney }
  if (!hasMinRole(who.role, def.minRole)) return no
  if (def.money && !canSeeMoney) return no
  if (!team && !def.selfAllowed) return no
  return { allowed: true, userId: team ? null : who.userId, canExport: team, canSeeMoney }
}

/** The menu: reports this person may open, in order, with what they may export. */
export function menuFor(who: { userId: string; role: AccountRole }) {
  return REPORTS.flatMap((def) => {
    const a = accessFor(def, who)
    if (!a.allowed) return []
    return [{ key: def.key, title: a.userId && def.key === 'all' ? 'My report' : def.title, group: def.group, path: def.path, exports: a.canExport ? EXPORT_FORMATS : [], tabs: def.tabs }]
  })
}
