import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Messenger inbound (POST /api/facebook/webhook):
 *  - Bug: Messenger messages never fired Automations (only Lead Ads did).
 *  - Bug: Meta resends a notification for up to 36 hours; there is no
 *    unique index on messages.message_id, so the "duplicate" catch never
 *    fired and a resend was saved — and answered — a second time.
 *  - Bug: the customer's name was fetched and overwritten on every message,
 *    undoing an agent's correction.
 */

const h = vi.hoisted(() => ({
  saved: [] as Array<Record<string, unknown>>,
  contactExists: false,
  automations: [] as string[],
  flows: 0,
  fetches: [] as string[],
  upsertUpdate: null as unknown,
}))

vi.mock('@/lib/social/webhook-secrets', () => ({
  socialWebhookScope: async () => ({ all: true }),
  scopeAllows: () => true,
  sameToken: () => false,
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/audit/actors', () => ({ webhookRejected: () => {}, webhookWrote: () => {} }))
vi.mock('@/lib/ads/attribution', () => ({ recordAdTouch: async () => {}, referralFromMeta: () => null }))
vi.mock('@/lib/meta-ads/api', () => ({ fetchLead: async () => null, getLeadField: () => null, fetchAdTargeting: async () => null }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: async () => { h.flows++; return { consumed: false, outcome: 'no_match' } } }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: async (a: { triggerType: string }) => { h.automations.push(a.triggerType) } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: () => ({ catch: () => Promise.resolve() }),
    $queryRaw: async () => [{ account_id: 'acc-1', access_token: 'EAApage', verify_token: 'v', page_id: '1029' }],
    profile: { findFirst: async () => ({ user_id: 'owner' }) },
    contact: {
      findFirst: async () => (h.contactExists ? { id: 'c1' } : null),
      upsert: async (a: { update: unknown }) => { h.upsertUpdate = a.update; h.contactExists = true; return { id: 'c1' } },
    },
    conversation: {
      findFirst: async () => ({ id: 'conv-1' }),
      update: async () => ({ id: 'conv-1' }),
    },
    message: {
      findFirst: async (a: { where: { message_id: string } }) => h.saved.find((m) => m.message_id === a.where.message_id) ?? null,
      create: async (a: { data: Record<string, unknown> }) => { h.saved.push(a.data); return { id: `m${h.saved.length}`, ...a.data } },
      count: async () => h.saved.length,
    },
  },
}))

import { POST } from './route'

const event = (mid: string) => ({
  object: 'page',
  entry: [{ id: '1029', messaging: [{ sender: { id: '7654321' }, recipient: { id: '1029' }, timestamp: 1763290000000, message: { mid, text: 'hello' } }] }],
})
const post = (body: unknown) => POST(new NextRequest('http://x/api/facebook/webhook', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.saved = []
  h.contactExists = false
  h.automations = []
  h.flows = 0
  h.fetches = []
  h.upsertUpdate = null
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { h.fetches.push(String(url)); return new Response('{"name":"Asha K"}', { status: 200 }) }))
})

describe('Messenger inbound', () => {
  it('a new message is saved once and fires the automations', async () => {
    await post(event('m_1'))
    await vi.waitFor(() => expect(h.automations.length).toBeGreaterThan(0))
    expect(h.saved).toHaveLength(1)
    expect(h.automations).toEqual(expect.arrayContaining(['new_contact_created', 'first_inbound_message', 'new_message_received', 'keyword_match']))
  })

  it('the same message delivered twice is saved and answered once', async () => {
    await post(event('m_2'))
    await vi.waitFor(() => expect(h.flows).toBe(1))
    await post(event('m_2'))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.saved).toHaveLength(1)
    expect(h.flows).toBe(1)
  })

  it('an existing contact keeps its name and is not looked up again', async () => {
    h.contactExists = true
    await post(event('m_3'))
    await vi.waitFor(() => expect(h.saved).toHaveLength(1))
    expect(h.upsertUpdate).toEqual({})
    expect(h.fetches.filter((u) => u.includes('fields=name'))).toHaveLength(0)
  })

  it('an event with no sender does not stop the rest of the batch', async () => {
    await post({
      object: 'page',
      entry: [{ id: '1029', messaging: [
        { recipient: { id: '1029' }, timestamp: 1763290000000, message: { mid: 'mid.broken', text: 'x' } },
        { sender: { id: '7654321' }, recipient: { id: '1029' }, timestamp: 1763290000001, message: { mid: 'mid.good', text: 'hello' } },
      ] }],
    })
    await vi.waitFor(() => expect(h.saved.map((m) => m.message_id)).toEqual(['mid.good']))
  })
})
