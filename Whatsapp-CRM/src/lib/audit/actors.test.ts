import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Non-human actors in the audit log: a burst of bad webhook signatures is
 * one counted event, sweeps record one summary only when they changed
 * something, and API-key calls are grouped per key per endpoint per hour.
 */

const calls = vi.hoisted(() => [] as Array<{ ctx: Record<string, unknown>; entry: Record<string, unknown> }>)

vi.mock('@/lib/audit/write', async (orig) => {
  const real = await orig<typeof import('./write')>()
  return {
    ...real,
    audit: vi.fn(async (ctx: Record<string, unknown>, e: unknown) => {
      for (const entry of (Array.isArray(e) ? e : [e]) as Array<Record<string, unknown>>) calls.push({ ctx, entry })
    }),
  }
})

import { webhookRejected, withJobAudit, argNames, agentRecordWritten } from './actors'
import { resetThrottleForTests, flushThrottled, onceWithin } from './throttle'
import { recordApiKeyUse, flushApiKeyUsage, normaliseEndpoint, pendingApiKeyUsage } from './usage'
import { prepare } from './write'

const ACC = '11111111-1111-4111-8111-111111111111'
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  calls.length = 0
  resetThrottleForTests()
})
afterEach(() => vi.useRealTimers())

describe('rejected webhooks', () => {
  it('a burst of bad signatures becomes at most one event per minute, with the count', async () => {
    vi.useFakeTimers()
    for (let i = 0; i < 50; i++) webhookRejected('whatsapp', null, 'signature_mismatch')
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
    expect(calls[0].entry).toMatchObject({ action: 'system.webhook_rejected', outcome: 'denied', meta: { provider: 'whatsapp', count: 50 } })
    expect(calls[0].ctx).toMatchObject({ actor: { type: 'webhook', id: 'whatsapp' } })
    // A new minute starts a new count.
    webhookRejected('whatsapp', null, 'signature_mismatch')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
    expect(calls[1].entry).toMatchObject({ meta: { count: 1 } })
  })

  it('providers are counted apart, and open counts are written on shutdown', async () => {
    webhookRejected('razorpay', ACC, 'bad_signature')
    webhookRejected('razorpay', ACC, 'bad_signature')
    webhookRejected('facebook', null, 'bad_signature')
    await flushThrottled()
    expect(calls.map((c) => [c.ctx.actor, (c.entry.meta as { count: number }).count])).toEqual(
      expect.arrayContaining([[{ type: 'webhook', id: 'razorpay' }, 2], [{ type: 'webhook', id: 'facebook' }, 1]]),
    )
  })

  it('once-per-window keys (file views)', () => {
    expect(onceWithin('k', 1000, 0)).toBe(true)
    expect(onceWithin('k', 1000, 500)).toBe(false)
    expect(onceWithin('k', 1000, 1500)).toBe(true)
  })
})

describe('sweeps', () => {
  it('one summary for a run that changed something, nothing for an idle run, same result either way', async () => {
    expect(await withJobAudit('idle-close', async () => ({ closed: 3 }), (r) => r.closed)).toEqual({ closed: 3 })
    expect(await withJobAudit('idle-close', async () => ({ closed: 0 }), (r) => r.closed)).toEqual({ closed: 0 })
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].entry).toMatchObject({ action: 'system.job_wrote', meta: { changed: 3 } })
    expect(calls[0].ctx).toMatchObject({ actor: { type: 'system', id: 'idle-close' }, source: 'job' })
  })

  it('a sweep that throws still throws, and is recorded as failed', async () => {
    await expect(withJobAudit('gmail', async () => { throw new Error('quota') }, () => 1)).rejects.toThrow('quota')
    await tick()
    expect(calls[0].entry).toMatchObject({ action: 'system.job_failed', outcome: 'failure', reason: 'quota' })
  })
})

describe('agents', () => {
  it('records the agent as the actor, never a person, and only field and argument names', async () => {
    expect(argNames({ phone: '+91 98470 12345', name: 'Anu' })).toEqual(['name', 'phone'])
    await agentRecordWritten(ACC, { kind: 'ai_reply', correlationId: 'turn-1' }, { tool: 'save_my_details', op: 'update', target: { type: 'contact', id: 'c1' }, fields: ['phone'] })
    const row = prepare(calls[0].ctx as never, calls[0].entry as never)
    expect(row).toMatchObject({ actor_type: 'agent', actor_id: 'ai_reply', on_behalf_of: null, correlation_id: 'turn-1', action: 'agent.record_written' })
    expect(row.meta).toMatchObject({ tool: 'save_my_details', op: 'update', fields: ['phone'] })
  })
})

describe('API-key use', () => {
  it('is grouped per key per endpoint per hour, ids in the path folded away', async () => {
    const now = new Date('2026-11-02T10:15:00Z')
    for (let i = 0; i < 3; i++) {
      recordApiKeyUse({ accountId: ACC, keyId: 'key1', url: `http://x/api/leads/${'22222222-2222-4222-8222-22222222222' + i}`, method: 'GET', now })
    }
    recordApiKeyUse({ accountId: ACC, keyId: 'key1', url: 'http://x/api/leads', method: 'POST', now })
    expect(normaliseEndpoint('/api/leads/22222222-2222-4222-8222-222222222222/notes')).toBe('/api/leads/:id/notes')
    expect(pendingApiKeyUsage().map((c) => [c.endpoint, c.method, c.count])).toEqual([['/api/leads/:id', 'GET', 3], ['/api/leads', 'POST', 1]])
    await flushApiKeyUsage()
    expect(calls).toHaveLength(2)
    expect(calls[0].entry).toMatchObject({ action: 'access.api_key_used', meta: { key_id: 'key1', endpoint: '/api/leads/:id', method: 'GET', count: 3 } })
    expect(calls[0].ctx).toMatchObject({ actor: { type: 'api_key', id: 'key1' } })
    expect(pendingApiKeyUsage()).toEqual([])
  })
})
