import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as unknown[], fail: false, open: true }))
vi.mock('@/lib/db', () => ({
  prisma: { aiHandover: { create: (a: { data: unknown }) => { if (h.fail) return Promise.reject(new Error('relation "ai_handovers" does not exist')); h.rows.push(a.data); return Promise.resolve(a.data) } } },
}))
vi.mock('./team-hours', () => ({ teamHoursNow: () => Promise.resolve({ open: h.open, hours: null, back: null }) }))

import { handoverRecord, logHandover } from './handover-log'

describe('handoverRecord', () => {
  it('known reasons are kept; anything else is "other"', () => {
    expect(handoverRecord({ accountId: 'a', conversationId: 'c', source: 'ai', reason: 'turn_limit' }, true).reason).toBe('turn_limit')
    expect(handoverRecord({ accountId: 'a', conversationId: 'c', source: 'ai', reason: "x'; DROP" }, true).reason).toBe('other')
  })
  it('the question is trimmed to 500 characters; empty is none', () => {
    expect(handoverRecord({ accountId: 'a', conversationId: 'c', source: 'flow', reason: 'low_confidence', question: 'x'.repeat(900) }, true).question).toHaveLength(500)
    expect(handoverRecord({ accountId: 'a', conversationId: 'c', source: 'flow', reason: 'low_confidence', question: '   ' }, true).question).toBeNull()
  })
  it('outside hours when the team is closed', () => {
    expect(handoverRecord({ accountId: 'a', conversationId: 'c', source: 'ai', reason: 'other' }, false).outside_hours).toBe(true)
  })
})

describe('logHandover', () => {
  it('writes one row', async () => {
    h.rows = []; h.fail = false; h.open = false
    await logHandover({ accountId: 'a', conversationId: 'c', source: 'ai', reason: 'asked_for_person' })
    expect(h.rows).toEqual([{ account_id: 'a', conversation_id: 'c', source: 'ai', reason: 'asked_for_person', outside_hours: true, question: null }])
  })
  it('never throws: a server without migration 163 still hands over', async () => {
    h.fail = true
    await expect(logHandover({ accountId: 'a', conversationId: 'c', source: 'ai', reason: 'other' })).resolves.toBeUndefined()
  })
})

describe('flowReason', () => {
  it("maps a chatbot flow's end reasons onto the report's reasons", async () => {
    const { flowReason } = await import('./handover-log')
    expect(flowReason('handoff_node')).toBe('flow_step')
    expect(flowReason('ai_reply_safety_guard')).toBe('escalation_topic')
    expect(flowReason('customer_asked_for_a_person')).toBe('asked_for_person')
    expect(flowReason('low_confidence')).toBe('low_confidence')
  })
})
