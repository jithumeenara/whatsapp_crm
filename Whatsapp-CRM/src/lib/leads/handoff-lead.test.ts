import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Talk to a person" in the Website Bot must leave a lead and tell the
// team, as a new WhatsApp enquiry does — not only move the chat to
// Pending in the Inbox.

const h = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  notes: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ eventType: string; id: unknown }>,
  pushes: [] as Array<{ userId: string; payload: Record<string, unknown> }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findFirst: () => Promise.resolve(h.existing),
      create: ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return Promise.resolve({ id: 'lead-new', assigned_to: null, ai_suggested: false, ...data })
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        h.updated.push(data)
        return Promise.resolve({ ...h.existing, ...data })
      },
    },
    contact: { findFirst: () => Promise.resolve({ name: 'Anu' }) },
    leadActivity: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        h.notes.push(data)
        return Promise.resolve(data)
      },
    },
  },
}))

vi.mock('@/lib/socket', () => ({
  emitToAccount: (_a: string, _t: string, e: { eventType: string; new: { id: unknown } }) =>
    h.events.push({ eventType: e.eventType, id: e.new.id }),
}))

vi.mock('@/lib/push', () => ({
  sendPushToUser: (userId: string, payload: Record<string, unknown>) => {
    h.pushes.push({ userId, payload })
    return Promise.resolve()
  },
}))

import { leadForHandoff } from './handoff-lead'

const args = { accountId: 'acc', userId: 'owner', contactId: 'c1', source: 'website', conversationId: 'conv1' }

beforeEach(() => {
  h.existing = null
  h.created.length = 0
  h.updated.length = 0
  h.notes.length = 0
  h.events.length = 0
  h.pushes.length = 0
})

describe('Talk to a person leaves a lead and tells the team', () => {
  it('creates a New Pool lead and announces it when the customer has none', async () => {
    const r = await leadForHandoff(args)
    expect(r).toEqual({ leadId: 'lead-new', created: true })
    expect(h.created[0]).toMatchObject({ account_id: 'acc', contact_id: 'c1', status: 'new', source: 'website', title: 'Anu' })
    expect(h.events).toEqual([{ eventType: 'INSERT', id: 'lead-new' }])
    expect(h.notes).toHaveLength(1)
  })

  it('announces an unclaimed open lead again instead of making a second one', async () => {
    h.existing = { id: 'lead-1', title: 'Anu', status: 'new', assigned_to: null, ai_suggested: false }
    const r = await leadForHandoff(args)
    expect(r).toEqual({ leadId: 'lead-1', created: false })
    expect(h.created).toHaveLength(0)
    expect(h.events).toEqual([{ eventType: 'INSERT', id: 'lead-1' }])
  })

  it("tells the owner of a claimed lead by push, opening that chat", async () => {
    h.existing = { id: 'lead-2', title: 'Anu', status: 'visited', assigned_to: 'agent-7', ai_suggested: false }
    await leadForHandoff(args)
    expect(h.created).toHaveLength(0)
    expect(h.events).toEqual([{ eventType: 'UPDATE', id: 'lead-2' }])
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0].userId).toBe('agent-7')
    expect(h.pushes[0].payload.data).toMatchObject({ type: 'assignment', conversationId: 'conv1' })
  })

  it("confirms a lead the assistant had only suggested", async () => {
    h.existing = { id: 'lead-3', title: 'Anu', status: 'new', assigned_to: null, ai_suggested: true }
    await leadForHandoff(args)
    expect(h.updated).toEqual([{ ai_suggested: false }])
    expect(h.events).toEqual([{ eventType: 'INSERT', id: 'lead-3' }])
  })
})
