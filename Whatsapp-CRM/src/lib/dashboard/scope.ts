/**
 * Who sees what on the owner dashboard. The rule is the one GET
 * /api/dashboard already uses: an agent, a viewer, and anybody whose profile
 * says "assigned only" see their own work, whatever their rank. Only an
 * unrestricted supervisor or above sees the team; only an unrestricted owner
 * or admin sees money.
 */

import { prisma } from '@/lib/db'
import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import type { DashboardView } from './owner-types'

export interface DashboardScope {
  view: DashboardView
  /** Revenue, previous revenue and pipeline are filled only when true. */
  money: boolean
  /** Whose numbers: null = the whole team. */
  userId: string | null
}

/** The member's "Assigned only" switch (Settings → Members). Read fresh. */
async function restrictedToAssigned(userId: string): Promise<boolean> {
  const p = await prisma.profile.findUnique({ where: { user_id: userId }, select: { restrict_to_assigned: true } })
  return p?.restrict_to_assigned === true
}

export async function resolveDashboardScope(ctx: { userId: string; role: AccountRole | string }): Promise<DashboardScope> {
  const role = ctx.role as AccountRole
  const own: DashboardScope = { view: 'agent', money: false, userId: ctx.userId }
  if (!hasMinRole(role, 'supervisor')) return own // agent, viewer
  if (await restrictedToAssigned(ctx.userId)) return own
  if (hasMinRole(role, 'admin')) return { view: 'owner', money: true, userId: null }
  return { view: 'team', money: false, userId: null }
}
