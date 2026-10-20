import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Bug, found 20 Oct: the "Assign conversation" step's Round robin mode
 * took the first profile of the account every time
 * (prisma.profile.findFirst with no order and no rotation), so every chat
 * went to the same person — the owner, or even a read-only viewer — and
 * nobody else on the team ever got one.
 *
 * Round robin means: the team's agents take turns, and only people who
 * can actually work a chat are in the turn.
 */

type Profile = { user_id: string; account_id: string; account_role: string; full_name: string; email: string }

const h = vi.hoisted(() => ({
  profiles: [] as Profile[],
  assigned: [] as string[],
  rotations: new Map<string, { account_id: string; scope: string; last_user_id: string | null; turn: number }>(),
}))

vi.mock('@/lib/db', () => {
  const profileMatches = (p: Profile, where: Record<string, unknown> = {}) => {
    if (where.account_id && p.account_id !== where.account_id) return false
    const role = where.account_role as { in?: string[] } | undefined
    if (role?.in && !role.in.includes(p.account_role)) return false
    const uid = where.user_id as { in?: string[] } | undefined
    if (uid?.in && !uid.in.includes(p.user_id)) return false
    return true
  }
  const prisma = {
    contact: { findFirst: () => Promise.resolve({ id: 'c1' }), findUnique: () => Promise.resolve({ name: 'Asha', phone: '919800000001' }) },
    automation: { findMany: () => Promise.resolve([{ id: 'a1', account_id: 'acc', user_id: 'owner', trigger_type: 'new_message_received', trigger_config: {}, is_active: true }]), update: () => Promise.resolve({}) },
    automationStep: {
      findMany: (args: { where: { parent_step_id: string | null } }) =>
        Promise.resolve(args.where.parent_step_id === null ? [{ id: 's1', step_type: 'assign_conversation', step_config: { mode: 'round_robin' }, position: 0, parent_step_id: null, branch: null }] : []),
    },
    automationLog: { create: () => Promise.resolve({ id: 'log' }), findUnique: () => Promise.resolve({ steps_executed: [], status: 'success' }), update: () => Promise.resolve({}) },
    automationPendingExecution: { create: () => Promise.resolve({}) },
    // Everyone signed in just now (presence), no open chats yet (load).
    user: { findMany: () => Promise.resolve(h.profiles.map((p) => ({ id: p.user_id, last_seen_at: new Date(), went_offline_at: null }))) },
    assignmentEvent: { create: () => Promise.resolve({}) },
    conversation: {
      groupBy: () => Promise.resolve([]),
      findMany: () => Promise.resolve([{ id: 'conv1', assigned_agent_id: null }]),
      findFirst: () => Promise.resolve({ id: 'conv1' }),
      updateMany: (args: { data: { assigned_agent_id: string } }) => {
        h.assigned.push(args.data.assigned_agent_id)
        return Promise.resolve({ count: 1 })
      },
    },
    profile: {
      findFirst: (args: { where?: Record<string, unknown> } = {}) => Promise.resolve(h.profiles.find((p) => profileMatches(p, args.where)) ?? null),
      findMany: (args: { where?: Record<string, unknown> } = {}) => Promise.resolve(h.profiles.filter((p) => profileMatches(p, args.where))),
    },
    assignmentRotation: {
      findUnique: (args: { where: { account_id_scope: { account_id: string; scope: string } } }) =>
        Promise.resolve(h.rotations.get(`${args.where.account_id_scope.account_id}:${args.where.account_id_scope.scope}`) ?? null),
      upsert: (args: { where: { account_id_scope: { account_id: string; scope: string } }; create: { last_user_id: string; turn: number }; update: { last_user_id: string; turn: number } }) => {
        const key = `${args.where.account_id_scope.account_id}:${args.where.account_id_scope.scope}`
        const prev = h.rotations.get(key)
        const next = prev ? { ...prev, ...args.update } : { account_id: args.where.account_id_scope.account_id, scope: args.where.account_id_scope.scope, ...args.create }
        h.rotations.set(key, next)
        return Promise.resolve(next)
      },
    },
    $queryRaw: () => Promise.resolve([]),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  return { prisma }
})

vi.mock('@/lib/push', () => ({ sendPushToUser: () => Promise.resolve() }))

import { runAutomationsForTrigger } from './engine'

const team: Profile[] = [
  { user_id: 'owner', account_id: 'acc', account_role: 'owner', full_name: 'Owner', email: 'owner@example.com' },
  { user_id: 'viewer', account_id: 'acc', account_role: 'viewer', full_name: 'Viewer', email: 'viewer@example.com' },
  { user_id: 'anu', account_id: 'acc', account_role: 'agent', full_name: 'Anu', email: 'anu@example.com' },
  { user_id: 'biju', account_id: 'acc', account_role: 'agent', full_name: 'Biju', email: 'biju@example.com' },
  { user_id: 'ciya', account_id: 'acc', account_role: 'supervisor', full_name: 'Ciya', email: 'ciya@example.com' },
]

beforeEach(() => {
  h.profiles = [...team]
  h.assigned = []
  h.rotations.clear()
})

const fire = () => runAutomationsForTrigger({ accountId: 'acc', triggerType: 'new_message_received', contactId: 'c1', context: { conversation_id: 'conv1' } })

describe('Assign conversation — round robin', () => {
  it('the team takes turns: three chats go to three different people', async () => {
    await fire()
    await fire()
    await fire()
    expect(new Set(h.assigned).size).toBe(3)
  })

  it('a read-only viewer never gets a chat to work', async () => {
    for (let i = 0; i < 6; i++) await fire()
    expect(h.assigned).not.toContain('viewer')
  })

  it('after everyone has had one, it starts again with the first', async () => {
    for (let i = 0; i < 4; i++) await fire()
    expect(h.assigned[3]).toBe(h.assigned[0])
  })
})
