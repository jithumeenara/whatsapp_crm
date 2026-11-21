import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  lead: { id: 'L1', title: 'Anu', contact_id: 'C1', assigned_to: 'me' as string | null } as null | Record<string, unknown>,
  convWhere: [] as Array<Record<string, unknown>>,
  msgWhere: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  summary: null as null | Record<string, unknown>,
  upserts: [] as Array<Record<string, unknown>>,
  aiCalls: [] as Array<{ system: string; user: string }>,
  aiReply: '**Customer asked for fees.** We sent them. Waiting for a reply. Extra.',
  translateCalls: 0,
  updateMany: [] as Array<Record<string, unknown>>,
  perLeadOk: true,
  notes: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    if (min === 'agent' && h.role === 'viewer') throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'me', role: h.role, pageAccess: null }
  },
  assertPageAccess: () => {},
  toErrorResponse: (e: { status?: number }) => new Response(JSON.stringify({ error: 'x' }), { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/auth/roles', () => ({ canViewAllLeads: (r: string) => ['owner', 'admin', 'supervisor'].includes(r) }))
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { aiCall: { limit: 30, windowMs: 60000 } },
  checkRateLimit: (key: string) => ({ success: key.startsWith('lead-summary:') ? h.perLeadOk : true }),
  rateLimitResponse: () => new Response('slow', { status: 429 }),
}))
vi.mock('@/lib/ai/providers/registry', () => ({
  getProviderKeys: () => ({ gemini: { api_key: 'enc' } }),
  generateAiReplyWithFallback: async (_c: unknown, system: string, user: string) => {
    h.aiCalls.push({ system, user })
    return { reply: h.aiReply, usedProvider: 'gemini', usedModel: 'm', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
  },
}))
vi.mock('@/lib/ai/translate', () => ({
  TRANSLATE_MODEL: 't',
  detectAndTranslate: async () => { h.translateCalls++; return { translatedText: 'ഫീസ് ചോദിച്ചു.', detectedLanguage: 'English' } },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'key' }))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: async () => {} }))
vi.mock('@/lib/audit', () => ({ audit: async (_c: unknown, e: Record<string, unknown>) => { h.audits.push(e) }, auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findFirst: async ({ where }: { where: { id: string; account_id: string } }) => (where.account_id === 'acc' && where.id === 'L1' ? h.lead : null) },
    conversation: { findMany: async ({ where }: { where: Record<string, unknown> }) => { h.convWhere.push(where); return [{ id: 'V1' }] } },
    message: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => { h.msgWhere.push(where); return h.messages },
      count: async () => 2,
    },
    aiConfig: { findUnique: async () => ({ temperature: 0.7, max_tokens: 1000, active_provider: 'gemini', fallback_provider: null, provider_keys: {} }) },
    leadSummary: {
      findUnique: async () => h.summary,
      upsert: async (a: { create: Record<string, unknown> }) => {
        h.upserts.push(a)
        return { ...a.create, translations: {}, feedback: null, created_at: new Date(), updated_at: new Date('2026-11-21T10:00:00Z') }
      },
      updateMany: async (a: Record<string, unknown>) => { h.updateMany.push(a); return { count: 1 } },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...h.summary, ...data }),
    },
    leadActivity: { create: async ({ data }: { data: Record<string, unknown> }) => { h.notes.push(data); return { id: 'N1' } } },
  },
}))

import { GET, PATCH, POST } from './route'

const req = (method: string, body?: unknown, q = '') =>
  new NextRequest(`http://x/api/leads/L1/summary${q}`, { method, body: body ? JSON.stringify(body) : undefined })
const p = (id = 'L1') => ({ params: Promise.resolve({ id }) })
const msg = (sender_type: string, content_text: string, m: number) => ({ sender_type, content_text, transcript: null, content_type: 'text', media_filename: null, created_at: new Date(Date.UTC(2026, 10, 21, 9, m)) })
const savedSummary = (extra: Record<string, unknown> = {}) => ({
  id: 'S1', account_id: 'acc', focus: '', text_en: 'Customer asked for fees.', translations: {}, message_count: 3,
  last_message_at: new Date(), feedback: null, created_at: new Date(), updated_at: new Date('2026-11-21T10:00:00Z'), ...extra,
})

beforeEach(() => {
  h.role = 'agent'
  h.lead = { id: 'L1', title: 'Anu', contact_id: 'C1', assigned_to: 'me' }
  h.convWhere = []; h.msgWhere = []; h.upserts = []; h.aiCalls = []; h.updateMany = []; h.notes = []; h.audits = []
  h.messages = [msg('customer', 'fees ethra?', 1), msg('agent', 'Fee is 5,900', 2), msg('customer', 'ok thanks', 3)]
  h.summary = null
  h.translateCalls = 0
  h.perLeadOk = true
})

describe('POST /api/leads/[id]/summary', () => {
  it('a lead in another account is not found', async () => {
    expect((await POST(req('POST', {}), p('other'))).status).toBe(404)
    expect(h.aiCalls).toHaveLength(0)
  })

  it('an agent cannot summarise a lead assigned to somebody else', async () => {
    h.lead = { ...h.lead!, assigned_to: 'someone-else' }
    expect((await POST(req('POST', {}), p())).status).toBe(403)
    expect(h.aiCalls).toHaveLength(0)
  })

  it('a viewer may read but not make one', async () => {
    h.role = 'viewer'
    expect((await POST(req('POST', {}), p())).status).toBe(403)
    expect((await GET(req('GET'), p())).status).toBe(200)
  })

  it('reads only the agent’s own conversations, and only customer, staff and bot messages', async () => {
    await POST(req('POST', {}), p())
    expect(h.convWhere[0]).toMatchObject({ contact_id: 'C1', account_id: 'acc', assigned_agent_id: 'me' })
    expect(h.msgWhere[0]).toMatchObject({ sender_type: { in: ['customer', 'agent', 'bot'] }, deleted_at: null })
  })

  it('a supervisor reads every conversation of the contact', async () => {
    h.role = 'supervisor'
    h.lead = { ...h.lead!, assigned_to: 'someone-else' }
    await POST(req('POST', {}), p())
    expect(h.convWhere[0]).not.toHaveProperty('assigned_agent_id')
  })

  it('too little chat: says so and never calls the AI', async () => {
    h.messages = h.messages.slice(0, 2)
    const res = await POST(req('POST', {}), p())
    expect(res.status).toBe(422)
    expect(h.aiCalls).toHaveLength(0)
  })

  it('makes a clean three-sentence English summary, saved once per lead and focus', async () => {
    const res = await POST(req('POST', { focus: '  Fees ' }), p())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.text).toBe('Customer asked for fees. We sent them. Waiting for a reply.')
    expect(h.aiCalls[0].system).toContain('"fees"')
    expect(h.aiCalls[0].user).toContain('Customer: fees ethra?')
    expect(h.upserts[0]).toMatchObject({ where: { lead_id_focus: { lead_id: 'L1', focus: 'fees' } } })
    expect(h.upserts[0].create).toMatchObject({ account_id: 'acc', lead_id: 'L1', focus: 'fees', message_count: 3, created_by: 'me' })
    expect(h.audits[0]).toMatchObject({ target: { type: 'lead', id: 'L1' } })
  })

  it('a refresh clears old translations (they belonged to the old text)', async () => {
    await POST(req('POST', {}), p())
    expect((h.upserts[0] as { update: Record<string, unknown> }).update).toMatchObject({ translations: {}, feedback: null })
  })

  it('five an hour per lead: the sixth is refused before the AI is called', async () => {
    h.perLeadOk = false
    expect((await POST(req('POST', {}), p())).status).toBe(429)
    expect(h.aiCalls).toHaveLength(0)
  })
})

describe('PATCH translate', () => {
  it('refuses a language that is not offered', async () => {
    h.summary = savedSummary()
    expect((await PATCH(req('PATCH', { action: 'translate', lang: 'xx' }), p())).status).toBe(400)
  })

  it('a cached translation is returned without calling the AI', async () => {
    h.summary = savedSummary({ translations: { ml: 'പഴയത്' } })
    const res = await PATCH(req('PATCH', { action: 'translate', lang: 'ml' }), p())
    expect((await res.json()).cached).toBe(true)
    expect(h.translateCalls).toBe(0)
  })

  it('a new language is translated once and saved only onto the same version of the summary', async () => {
    h.summary = savedSummary()
    const res = await PATCH(req('PATCH', { action: 'translate', lang: 'ml' }), p())
    expect(res.status).toBe(200)
    expect(h.translateCalls).toBe(1)
    expect(h.updateMany[0]).toMatchObject({ where: { id: 'S1', updated_at: new Date('2026-11-21T10:00:00Z') }, data: { translations: { ml: 'ഫീസ് ചോദിച്ചു.' } } })
  })

  it('nothing to translate before a summary exists', async () => {
    expect((await PATCH(req('PATCH', { action: 'translate', lang: 'ml' }), p())).status).toBe(404)
  })
})

describe('PATCH save_note and feedback', () => {
  it('saves the person’s checked text as a lead note', async () => {
    const res = await PATCH(req('PATCH', { action: 'save_note', text: '  Asked for fees; sent.  ' }), p())
    expect(res.status).toBe(200)
    expect(h.notes[0]).toMatchObject({ account_id: 'acc', lead_id: 'L1', user_id: 'me', type: 'note', description: 'Asked for fees; sent.' })
  })

  it('an empty note is refused', async () => {
    expect((await PATCH(req('PATCH', { action: 'save_note', text: '  ' }), p())).status).toBe(400)
  })

  it('feedback accepts only up or down', async () => {
    h.summary = savedSummary()
    expect((await PATCH(req('PATCH', { action: 'feedback', vote: 'meh' }), p())).status).toBe(400)
    expect((await PATCH(req('PATCH', { action: 'feedback', vote: 'down' }), p())).status).toBe(200)
  })
})
