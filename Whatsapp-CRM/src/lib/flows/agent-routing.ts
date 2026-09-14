/**
 * Choosing which person a conversation goes to, and telling them.
 *
 * Handoff used to take a single agent id chosen when the chatbot was
 * built. That is fine until the named person is on leave, asleep, or
 * simply not signed in — the conversation is assigned to them anyway and
 * waits, with the customer getting nothing and nobody aware it arrived.
 * This picks from whoever is actually working right now.
 *
 * **What "available" means here, and why it is not obvious.** Presence
 * comes from UserSession: a row that has not been revoked and whose
 * last_seen_at is recent. The catch is that last_seen_at is deliberately
 * throttled — src/auth.ts only writes it every five minutes, to keep a
 * database write off every request. So a person who is actively typing
 * can still have a last_seen_at five minutes old, and any window at or
 * below that would rule out the very people who are working. The default
 * window is therefore the idle timeout (10 minutes, enforced in
 * src/proxy.ts — past it the session is dead anyway) plus that 5-minute
 * throttle. Shorter is not "stricter", it is wrong.
 *
 * Viewers are never candidates: the role cannot send a message, so
 * assigning one a conversation guarantees silence.
 */

import { prisma } from '@/lib/db'

/** Idle timeout (10m, src/proxy.ts) plus the last_seen_at write throttle
 *  (5m, src/auth.ts). Below this, active agents read as offline. */
export const DEFAULT_ONLINE_WINDOW_MINUTES = 15

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
  const windowMinutes = args.onlineWindowMinutes ?? DEFAULT_ONLINE_WINDOW_MINUTES
  const cutoff = new Date(Date.now() - windowMinutes * 60_000)

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
    },
  })
  if (profiles.length === 0) return []

  const userIds = profiles.map((p) => p.user_id)

  // Both counted in one query each rather than per agent: a busy account
  // has dozens of agents and this sits in the path between a customer's
  // message and somebody answering it.
  const [sessions, openCounts] = await Promise.all([
    prisma.userSession.groupBy({
      by: ['user_id'],
      where: { user_id: { in: userIds }, revoked_at: null },
      _max: { last_seen_at: true },
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

  const lastSeenByUser = new Map(sessions.map((s) => [s.user_id, s._max.last_seen_at ?? null]))
  const loadByUser = new Map(
    openCounts.map((c) => [c.assigned_agent_id as string, c._count._all]),
  )

  return profiles.map((p) => {
    const lastSeenAt = lastSeenByUser.get(p.user_id) ?? null
    return {
      userId: p.user_id,
      fullName: p.full_name || p.email,
      email: p.email,
      phone: normalizeAgentPhone(p),
      phoneVerified: Boolean(p.phone_verified_at),
      role: String(p.account_role),
      lastSeenAt,
      online: Boolean(lastSeenAt && lastSeenAt >= cutoff),
      openConversations: loadByUser.get(p.user_id) ?? 0,
    }
  })
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
    return { agent: named, reason: `assigned to ${named.fullName}` }
  }

  // Distinguished on purpose: "nobody is signed in" and "nobody here can
  // take a conversation at all" call for completely different actions,
  // and this sentence is what gets read in the run log.
  if (agents.length === 0) {
    return resolveFallback(agents, args, 'no one on this account can take a conversation')
  }
  const eligible = args.onlyOnline === false ? agents : agents.filter((a) => a.online)
  if (eligible.length === 0) {
    return resolveFallback(agents, args, 'nobody is signed in right now')
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
