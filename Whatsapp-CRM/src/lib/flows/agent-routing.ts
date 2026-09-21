/**
 * Choosing which person a conversation goes to, and telling them.
 *
 * Handoff used to take a single agent id chosen when the chatbot was
 * built. That is fine until the named person is on leave, asleep, or
 * simply not signed in — the conversation is assigned to them anyway and
 * waits, with the customer getting nothing and nobody aware it arrived.
 * This picks from whoever is actually working right now.
 *
 * **What "available" means here, and why it had to change.** This used
 * to read presence out of UserSession — an unrevoked row whose
 * last_seen_at was within fifteen minutes — while the Members list in
 * Settings read it out of users.last_seen_at on a completely different
 * window. Two screens, two answers, and the routing one was the worse of
 * the two: UserSession.last_seen_at is written at most every five
 * minutes, and a sign-out left the row unrevoked, so a flow could hand a
 * live customer to somebody who had pressed Log out and gone home while
 * a supervisor watched their dot sit grey.
 *
 * It now asks src/lib/agents/presence.ts, which is the same rule the dot
 * uses, fed by the same once-a-minute heartbeat, and which counts an
 * explicit departure. A flow node may still name its own window — some
 * accounts want a stricter one — but the default is no longer a number
 * invented here.
 *
 * **Being signed in is not the same as being on duty.** An agent at
 * their desk on a Sunday is genuinely online and genuinely off shift,
 * and handing them a customer is the same mistake as handing one to
 * somebody who has gone home. So a candidate has to be both, and the
 * run log says which of the two they failed — "signed in but off shift"
 * and "not signed in" call for different actions from whoever reads it.
 *
 * An agent with no hours set is always on shift, which is how every
 * account behaved before shifts existed and how they keep behaving
 * until somebody deliberately sets some.
 *
 * Viewers are never candidates: the role cannot send a message, so
 * assigning one a conversation guarantees silence.
 */

import { prisma } from '@/lib/db'
import { isAvailable } from '@/lib/agents/presence'
import { isOnShift, parseWorkingHours } from '@/lib/agents/working-hours'
import { SIGNED_OUT_AFTER_MS } from '@/lib/auth/session-timing'

/** Only meaningful when a flow node overrides it. Left exported because
 *  the flow builder shows it as the default in its own UI. */
export const DEFAULT_ONLINE_WINDOW_MINUTES = Math.round(SIGNED_OUT_AFTER_MS / 60_000)

/** Roles that can actually reply. A viewer cannot send, so routing one a
 *  conversation is the same as routing it nowhere. */
const REPLY_CAPABLE_ROLES = ['owner', 'supervisor', 'admin', 'agent'] as const

export type AgentPickStrategy =
  /** The one person named on the node. */
  | 'specific'
  /** Anyone signed in, fewest open conversations first. */
  | 'least_busy'
  /** Anyone signed in, longest-idle first, so work spreads out. */
  | 'round_robin'

export interface AgentCandidate {
  userId: string
  fullName: string
  email: string
  /** Their own WhatsApp number, for the handoff notification. */
  phone: string | null
  phoneVerified: boolean
  role: string
  lastSeenAt: Date | null
  online: boolean
  /** Within their working hours right now. True when they have none. */
  onShift: boolean
  /** Conversations already assigned to them and not closed. */
  openConversations: number
}

/**
 * Everyone on the account who could take a conversation, with their
 * current presence and load.
 */
export async function findAgents(args: {
  accountId: string
  /** Restrict to these roles; defaults to every reply-capable role. */
  roles?: string[]
  onlineWindowMinutes?: number
}): Promise<AgentCandidate[]> {
  // An override is a deliberate choice by whoever built the flow and is
  // honoured as given. With none, presence answers — see the note above
  // on why this file no longer keeps a window of its own.
  const overrideCutoff =
    args.onlineWindowMinutes != null
      ? new Date(Date.now() - args.onlineWindowMinutes * 60_000)
      : null

  const allowedRoles = (args.roles?.length ? args.roles : [...REPLY_CAPABLE_ROLES]).filter((r) =>
    (REPLY_CAPABLE_ROLES as readonly string[]).includes(r),
  )
  if (allowedRoles.length === 0) return []

  const profiles = await prisma.profile.findMany({
    where: { account_id: args.accountId, account_role: { in: allowedRoles as never } },
    select: {
      user_id: true,
      full_name: true,
      email: true,
      phone: true,
      phone_verified_at: true,
      account_role: true,
      working_hours: true,
    },
  })
  if (profiles.length === 0) return []

  const userIds = profiles.map((p) => p.user_id)

  // Both counted in one query each rather than per agent: a busy account
  // has dozens of agents and this sits in the path between a customer's
  // message and somebody answering it.
  const [presence, openCounts] = await Promise.all([
    // users, not user_sessions: this is the heartbeat's own column,
    // written every minute on real activity, and it carries the
    // departure that a sign-out or a closed window records.
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, last_seen_at: true, went_offline_at: true },
    }),
    prisma.conversation.groupBy({
      by: ['assigned_agent_id'],
      where: {
        account_id: args.accountId,
        assigned_agent_id: { in: userIds },
        status: { not: 'closed' },
      },
      _count: { _all: true },
    }),
  ])

  const presenceByUser = new Map(presence.map((u) => [u.id, u]))
  const loadByUser = new Map(
    openCounts.map((c) => [c.assigned_agent_id as string, c._count._all]),
  )

  return profiles.map((p) => {
    const row = presenceByUser.get(p.user_id) ?? null
    const lastSeenAt = row?.last_seen_at ?? null
    const online = overrideCutoff
      ? Boolean(lastSeenAt && lastSeenAt >= overrideCutoff && !hasLeft(row))
      : isAvailable(row)
    return {
      onShift: isOnShift(parseWorkingHours(p.working_hours)),
      userId: p.user_id,
      fullName: p.full_name || p.email,
      email: p.email,
      phone: normalizeAgentPhone(p),
      phoneVerified: Boolean(p.phone_verified_at),
      role: String(p.account_role),
      lastSeenAt,
      online,
      openConversations: loadByUser.get(p.user_id) ?? 0,
    }
  })
}

/** A departure outranks any window, including one a flow node chose:
 *  somebody who pressed Log out is not reachable at five minutes or at
 *  fifty. */
function hasLeft(row: { last_seen_at: Date | null; went_offline_at: Date | null } | null): boolean {
  if (!row?.went_offline_at) return false
  return !row.last_seen_at || row.went_offline_at >= row.last_seen_at
}

/**
 * An agent's own WhatsApp number.
 *
 * Profile.phone is the real field. The `@agent.local` form is a legacy
 * shape from phone-only agent logins, where the number was encoded into
 * the email because there was nowhere else to put it; handoff used to
 * read *only* that, so an ordinary agent with a real email and a filled-in
 * phone got no notification at all.
 */
function normalizeAgentPhone(profile: { phone: string | null; email: string }): string | null {
  const direct = profile.phone?.replace(/[^\d]/g, '')
  if (direct) return direct
  if (profile.email.endsWith('@agent.local')) {
    const legacy = profile.email.replace('@agent.local', '').replace(/[^\d]/g, '')
    return legacy || null
  }
  return null
}

export interface AgentPickResult {
  agent: AgentCandidate | null
  /** Why this one, or why none — recorded on the run so a handoff that
   *  went nowhere can be explained without re-deriving it. */
  reason: string
}

/**
 * Picks who takes this conversation.
 *
 * Falls back deliberately rather than failing: an unassigned conversation
 * in the inbox is recoverable, and better than one assigned to somebody
 * who is not there.
 */
export async function pickAgent(args: {
  accountId: string
  strategy: AgentPickStrategy
  /** Required by the 'specific' strategy. */
  specificUserId?: string | null
  /** Skip agents who are not signed in. */
  onlyOnline?: boolean
  onlineWindowMinutes?: number
  roles?: string[]
  /** Used when the strategy finds nobody — typically a supervisor. */
  fallbackUserId?: string | null
}): Promise<AgentPickResult> {
  const agents = await findAgents({
    accountId: args.accountId,
    roles: args.roles,
    onlineWindowMinutes: args.onlineWindowMinutes,
  })

  if (args.strategy === 'specific') {
    const named = agents.find((a) => a.userId === args.specificUserId)
    if (!named) {
      return resolveFallback(agents, args, 'the agent this step names is no longer on this account')
    }
    // A named agent is honoured even when signed out unless the step
    // explicitly asked for online-only: naming somebody is a decision,
    // and quietly routing around it would be surprising.
    if (args.onlyOnline && !named.online) {
      return resolveFallback(agents, args, `${named.fullName} is not signed in`)
    }
    if (args.onlyOnline && !named.onShift) {
      return resolveFallback(agents, args, `${named.fullName} is outside their working hours`)
    }
    return { agent: named, reason: `assigned to ${named.fullName}` }
  }

  // Distinguished on purpose: "nobody is signed in" and "nobody here can
  // take a conversation at all" call for completely different actions,
  // and this sentence is what gets read in the run log.
  if (agents.length === 0) {
    return resolveFallback(agents, args, 'no one on this account can take a conversation')
  }
  // onlyOnline: false means "ignore availability entirely", which covers
  // both halves of it — a step that does not care whether somebody is at
  // their desk does not care whether it is their working day either.
  const eligible =
    args.onlyOnline === false ? agents : agents.filter((a) => a.online && a.onShift)
  if (eligible.length === 0) {
    // Worth separating. "Everybody is off shift" is a rota to change;
    // "nobody is signed in" is a person to call. A single sentence for
    // both would send whoever reads the run log looking in the wrong
    // place.
    const signedIn = agents.filter((a) => a.online)
    const why =
      signedIn.length > 0
        ? 'everybody signed in right now is outside their working hours'
        : 'nobody is signed in right now'
    return resolveFallback(agents, args, why)
  }

  if (args.strategy === 'round_robin') {
    // Longest since last seen first. Over a stream of handoffs this
    // spreads work without needing a stored pointer, which would have to
    // be kept correct as people join and leave.
    const sorted = [...eligible].sort(
      (a, b) => (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0),
    )
    return { agent: sorted[0], reason: `next in turn (${sorted[0].fullName})` }
  }

  // least_busy — ties broken by who has been idle longest, so two agents
  // with nothing on do not both keep getting the next conversation.
  const sorted = [...eligible].sort((a, b) => {
    if (a.openConversations !== b.openConversations) {
      return a.openConversations - b.openConversations
    }
    return (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0)
  })
  const chosen = sorted[0]
  return {
    agent: chosen,
    reason: `${chosen.fullName} has the fewest open conversations (${chosen.openConversations})`,
  }
}

function resolveFallback(
  agents: AgentCandidate[],
  args: { fallbackUserId?: string | null },
  why: string,
): AgentPickResult {
  if (args.fallbackUserId) {
    const fallback = agents.find((a) => a.userId === args.fallbackUserId)
    if (fallback) {
      return { agent: fallback, reason: `${why} — fell back to ${fallback.fullName}` }
    }
  }
  // Left in the inbox for whoever looks first. Deliberately not assigned
  // to an arbitrary person: an unassigned conversation is visible to
  // everyone, one assigned to somebody absent is visible to nobody.
  return { agent: null, reason: `${why} — left unassigned in the inbox` }
}
