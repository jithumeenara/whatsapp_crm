import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A write by the customer assistant is recorded as the agent — never as
 * the owner or a staff member — with argument and field NAMES only: the
 * number and name the visitor typed never reach the audit log.
 */

const calls = vi.hoisted(() => [] as Array<{ ctx: Record<string, unknown>; entry: Record<string, unknown> }>)

vi.mock('@/lib/audit/write', async (orig) => {
  const real = await orig<typeof import('@/lib/audit/write')>()
  return {
    ...real,
    audit: vi.fn(async (ctx: Record<string, unknown>, e: unknown) => {
      for (const entry of (Array.isArray(e) ? e : [e]) as Array<Record<string, unknown>>) calls.push({ ctx, entry })
    }),
  }
})
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/contacts/update-field', () => ({
  updateContactField: vi.fn(async () => ({ ok: true })),
  isAnonymousVisitor: vi.fn(async () => true),
}))

import { runCustomerTool } from './customer-tools'
import { prepare } from '@/lib/audit/write'

const ACC = '11111111-1111-4111-8111-111111111111'
const CONTACT = '33333333-3333-4333-8333-333333333333'
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  calls.length = 0
})

describe('audit of the assistant’s write tools', () => {
  it('save_my_details records agent.record_written and agent.tool_called as the agent, with no argument values', async () => {
    const out = await runCustomerTool(
      'save_my_details',
      { name: 'Anu Krishnan', phone: '+91 98470 12345' },
      { accountId: ACC, contactId: CONTACT, anonymous: true, audit: { kind: 'ai_reply', correlationId: 'ai-turn:x:1', conversationId: 'conv-1' } },
    )
    expect(out).toMatchObject({ saved: true })
    await tick()

    const actions = calls.map((c) => c.entry.action)
    expect(actions).toEqual(expect.arrayContaining(['agent.record_written', 'agent.tool_called']))
    for (const c of calls) {
      const row = prepare(c.ctx as never, c.entry as never)
      expect(row.actor_type).toBe('agent')
      expect(row.actor_id).toBe('ai_reply')
      expect(row.on_behalf_of).toBeNull()
      expect(row.correlation_id).toBe('ai-turn:x:1')
    }
    const written = calls.find((c) => c.entry.action === 'agent.record_written')!
    expect(written.entry).toMatchObject({ target: { type: 'contact', id: CONTACT }, meta: { tool: 'save_my_details', op: 'update', fields: ['name', 'phone'] } })
    const called = calls.find((c) => c.entry.action === 'agent.tool_called')!
    expect(called.entry).toMatchObject({ meta: { tool: 'save_my_details', args: ['name', 'phone'] } })

    const everything = JSON.stringify(calls)
    expect(everything).not.toMatch(/98470|12345|Anu|Krishnan/)
  })

  it('without an explicit identity a write is still the assistant, not a person', async () => {
    await runCustomerTool('save_my_details', { phone: '+91 98470 12345' }, { accountId: ACC, contactId: CONTACT, anonymous: true })
    await tick()
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.ctx.actor).toMatchObject({ type: 'agent', id: 'ai_reply' })
  })

  it('read tools are never recorded', async () => {
    await runCustomerTool('registration_forms', {}, { accountId: ACC, contactId: '', readOnly: true }).catch(() => null)
    await tick()
    expect(calls.filter((c) => c.entry.action === 'agent.tool_called')).toEqual([])
  })
})
