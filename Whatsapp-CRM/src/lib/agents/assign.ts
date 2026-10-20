/**
 * Choosing who gets a lead or a chat — one rule for automations, chatbot
 * handoffs, lead routing and bulk "Assign to".
 *
 * Methods:
 *   specific     the person named (honoured even when they are away; the
 *                reason says so).
 *   round_robin  the team takes turns. Only the last person given work is
 *                stored per queue, and the next is the first eligible
 *                person after them in a fixed order — so someone joining,
 *                leaving or going offline never makes the turn skip or
 *                repeat. Chosen under a Postgres advisory lock, so two
 *                servers handing out work at once cannot both pick the
 *                same "next".
 *   least_busy   fewest open chats first; ties go round the team.
 *
 * Only people who can reply (never a viewer), signed in and within their
 * working hours, are given work automatically. If nobody is, the record is
 * left in the pool — unassigned work is visible to everyone; work given to
 * someone absent is visible to no one. The reason names who was skipped.
 */

import { prisma } from '@/lib/db'
import { findAgents, type AgentCandidate } from '@/lib/flows/agent-routing'
import { takeTurn } from './rotation'

export type AssignMethod = 'specific' | 'round_robin' | 'least_busy'

export interface AssigneeChoice {
  userId: string | null
  name: string | null
  reason: string
}

/** Default team when none is chosen: the people whose job is chats. */
const WORKING_ROLES = ['agent', 'supervisor']

function skippedText(agents: AgentCandidate[]): string {
  const parts = agents.map((a) => `${a.fullName} ${!a.online ? 'not signed in' : 'outside working hours'}`)
  return parts.length ? `skipped: ${parts.slice(0, 5).join(', ')}${parts.length > 5 ? '…' : ''}` : ''
}

export async function chooseAssignee(args: {
  accountId: string
  method: AssignMethod
  /** For 'specific'. */
  userId?: string | null
  /** The team to choose from; empty/absent = everyone with an agent or supervisor role. */
  teamUserIds?: string[] | null
  /** The queue whose turn is kept (e.g. "automation:<id>", "lead-rule:<id>"). */
  scope: string
  /** false = ignore presence and hours (a deliberate bulk spread). */
  onlyAvailable?: boolean
  excludeUserIds?: string[]
}): Promise<AssigneeChoice> {
  const all = await findAgents({ accountId: args.accountId })

  if (args.method === 'specific') {
    const named = all.find((a) => a.userId === args.userId)
    if (!named) return { userId: null, name: null, reason: 'the chosen person is no longer on this account — left in the pool' }
    const note = !named.online ? ' (not signed in now)' : !named.onShift ? ' (outside working hours now)' : ''
    return { userId: named.userId, name: named.fullName, reason: `assigned to ${named.fullName}${note}` }
  }

  const team = args.teamUserIds?.length
    ? all.filter((a) => args.teamUserIds!.includes(a.userId))
    : (() => {
        const working = all.filter((a) => WORKING_ROLES.includes(a.role))
        return working.length > 0 ? working : all // a business with only owners/admins
      })()
  const candidates = team.filter((a) => !(args.excludeUserIds ?? []).includes(a.userId))
  if (candidates.length === 0) return { userId: null, name: null, reason: 'nobody in this team can take it — left in the pool' }

  const eligible = args.onlyAvailable === false ? candidates : candidates.filter((a) => a.online && a.onShift)
  const skipped = candidates.filter((a) => !eligible.includes(a))
  if (eligible.length === 0) {
    return { userId: null, name: null, reason: `nobody in the team is available right now (${skippedText(skipped)}) — left in the pool` }
  }

  const pool =
    args.method === 'least_busy'
      ? eligible.filter((a) => a.openConversations === Math.min(...eligible.map((x) => x.openConversations)))
      : eligible
  const chosen = (await takeTurn(args.accountId, args.scope, pool))!

  const how =
    args.method === 'least_busy'
      ? `fewest open chats (${chosen.openConversations})`
      : 'next in turn'
  const skip = skippedText(skipped)
  return { userId: chosen.userId, name: chosen.fullName, reason: `${chosen.fullName} — ${how}${skip ? `; ${skip}` : ''}` }
}

/** The "why" for a lead's or chat's timeline and the manager's report. */
export async function recordAssignment(args: {
  accountId: string
  recordType: 'lead' | 'conversation'
  recordId: string
  previousUserId: string | null
  newUserId: string | null
  actorUserId?: string | null
  source: string
  method?: string | null
  reason: string
}): Promise<void> {
  await prisma.assignmentEvent
    .create({
      data: {
        account_id: args.accountId,
        record_type: args.recordType,
        record_id: args.recordId,
        previous_user_id: args.previousUserId,
        new_user_id: args.newUserId,
        actor_user_id: args.actorUserId ?? null,
        source: args.source,
        method: args.method ?? null,
        reason: args.reason.slice(0, 500),
      },
    })
    .catch((err) => console.error('[assign] could not record the assignment:', err instanceof Error ? err.message : err))
}
