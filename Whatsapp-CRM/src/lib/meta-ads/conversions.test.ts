import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Results sent back to Meta: one queued row per result (a repeat is never
 * queued twice), sent at once, retried with back-off on a temporary error,
 * stopped on a permission error, skipped with plain words when something
 * is missing, and only Meta ids are stored (never a phone number).
 */

type Ev = Record<string, unknown> & { id: string; account_id: string; event_id: string; status: string; attempts: number; next_attempt_at: Date }
const h = vi.hoisted(() => ({
  events: [] as Ev[],
  settings: null as Record<string, unknown> | null,
  conv: null as { ctwa_clid: string; channel: string } | null,
  touch: null as { id: string } | null,
  contact: { facebook_id: '27453671160961579', phone: '919847012345' } as Record<string, unknown> | null,
  sub: null as { meta_leadgen_id: string } | null,
  fetches: [] as Array<{ url: string; body: unknown }>,
  fetchStatus: 200,
  fetchError: null as { code: number } | null,
  pageRows: [{ page_id: '101489656173087', access_token: 'sealed:PAGE' }] as Array<Record<string, unknown>>,
}))

let seq = 0
const matches = (r: Ev, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(r[k])
  if (v && typeof v === 'object' && 'lte' in (v as object)) return (r[k] as Date) <= (v as { lte: Date }).lte
  if (v && typeof v === 'object' && 'lt' in (v as object)) return (r[k] as Date) < (v as { lt: Date }).lt
  return r[k] === v
})

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, ''), openStoredSecret: (v: string | null) => (v ? v.replace(/^sealed:/, '') : null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    conversionSettings: {
      findUnique: async () => h.settings,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { h.settings = { ...(h.settings ?? create), ...update }; return h.settings },
    },
    conversation: { findFirst: async () => h.conv },
    adTouch: { findFirst: async () => h.touch },
    contact: { findFirst: async () => h.contact },
    deal: { findFirst: async () => null },
    leadAdSubmission: { findFirst: async () => h.sub },
    whatsAppConfig: { findFirst: async () => ({ access_token: 'enc:WA_TOKEN' }) },
    metaAdsConfig: { findUnique: async () => ({ dataset_id: '555', waba_id: '777', access_token: 'enc:ADS_TOKEN' }) },
    $queryRaw: async () => h.pageRows,
    conversionEvent: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) {
          if (h.events.some((e) => e.account_id === d.account_id && e.event_id === d.event_id)) continue
          h.events.push({ id: `ev-${++seq}`, status: 'pending', attempts: 0, next_attempt_at: new Date(0), created_at: new Date(), ...d } as Ev)
        }
        return { count: data.length }
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => h.events.filter((e) => matches(e, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = h.events.filter((e) => matches(e, where))
        for (const e of hit) for (const [k, v] of Object.entries(data)) (e as Record<string, unknown>)[k] = v && typeof v === 'object' && 'increment' in (v as object) ? (e[k] as number) + (v as { increment: number }).increment : v
        return { count: hit.length }
      },
    },
  },
}))

import { processConversion, reportConversion } from './conversions'

beforeEach(() => {
  h.events = []; h.settings = null; h.conv = null; h.touch = null; h.sub = null; h.fetches = []; h.fetchStatus = 200; h.fetchError = null; seq = 0
  h.contact = { facebook_id: '27453671160961579', phone: '919847012345' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    h.fetches.push({ url, body: init?.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/dataset')) return Response.json({ id: '888' })
    if (h.fetchError) return Response.json({ error: h.fetchError }, { status: h.fetchStatus })
    return new Response('{}', { status: h.fetchStatus })
  }))
})

describe('reporting a result', () => {
  it('a qualified lead from a WhatsApp ad: queued once, sent at once with the WhatsApp token, marked sent', async () => {
    h.conv = { ctwa_clid: 'clid-1', channel: 'whatsapp' }
    await reportConversion({ accountId: 'a', stage: 'qualified', contactId: 'c', leadId: 'L1' })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ target: 'business_messaging', channel: 'whatsapp', event_name: 'QualifiedLead', event_id: 'qualifiedlead:lead:L1', status: 'sent' })
    expect(h.fetches).toHaveLength(1)
    expect(h.fetches[0].url).toMatch(/\/555\/events$/)
  })

  it('the same result twice is queued and sent once', async () => {
    h.conv = { ctwa_clid: 'clid-1', channel: 'whatsapp' }
    await reportConversion({ accountId: 'a', stage: 'qualified', contactId: 'c', leadId: 'L1' })
    await reportConversion({ accountId: 'a', stage: 'qualified', contactId: 'c', leadId: 'L1' })
    expect(h.events).toHaveLength(1)
    expect(h.fetches).toHaveLength(1)
  })

  it('turned off: nothing is queued', async () => {
    h.settings = { enabled: false }
    h.conv = { ctwa_clid: 'clid-1', channel: 'whatsapp' }
    await reportConversion({ accountId: 'a', stage: 'qualified', contactId: 'c', leadId: 'L1' })
    expect(h.events).toHaveLength(0)
  })

  it('a Messenger ad chat: the Page dataset is made once, the Page-scoped id is sent — never the phone number', async () => {
    h.touch = { id: 't1' }
    await reportConversion({ accountId: 'a', stage: 'won', contactId: 'c', leadId: 'L2' })
    expect(h.events[0]).toMatchObject({ channel: 'messenger', status: 'sent' })
    const sent = h.fetches.find((f) => f.url.endsWith('/888/events'))?.body as { data: Array<{ user_data: Record<string, string>; messaging_channel: string }> }
    expect(sent.data[0].messaging_channel).toBe('messenger')
    expect(sent.data[0].user_data).toEqual({ page_id: '101489656173087', page_scoped_user_id: '27453671160961579' })
    expect(JSON.stringify(h.events)).not.toContain('919847012345')
  })

  it('a Lead Ads lead: every stage under the business’s name; without a dataset it is skipped in plain words', async () => {
    h.sub = { meta_leadgen_id: '1234567890123456' }
    h.settings = { enabled: true, stage_names: { raw: 'Enquiry', qualified: 'Hot', won: 'Joined', lost: 'Dropped' } }
    await reportConversion({ accountId: 'a', stage: 'raw', leadId: 'L3' })
    expect(h.events[0]).toMatchObject({ target: 'crm', event_name: 'Enquiry', status: 'skipped' })
    expect(h.events[0].last_error).toMatch(/Lead Ads dataset ID/)
    expect(h.fetches).toHaveLength(0)
  })

  it('a Lead Ads lead with a dataset: sent with Meta’s lead id and system_generated', async () => {
    h.sub = { meta_leadgen_id: '1234567890123456' }
    h.settings = { enabled: true, crm_dataset_id: '99999' }
    await reportConversion({ accountId: 'a', stage: 'qualified', leadId: 'L4' })
    const body = h.fetches[0].body as { data: Array<Record<string, unknown>> }
    expect(h.fetches[0].url).toMatch(/\/99999\/events$/)
    expect(body.data[0]).toMatchObject({ event_name: 'Qualified', action_source: 'system_generated', user_data: { lead_id: '1234567890123456' } })
  })
})

describe('retries', () => {
  it('Meta busy: back to the queue with a later attempt; a permission error stops', async () => {
    h.sub = { meta_leadgen_id: '1234567890123456' }
    h.settings = { enabled: true, crm_dataset_id: '99999' }
    h.fetchStatus = 500; h.fetchError = { code: 2 }
    await reportConversion({ accountId: 'a', stage: 'qualified', leadId: 'L5' })
    expect(h.events[0]).toMatchObject({ status: 'pending', attempts: 1 })
    expect((h.events[0].next_attempt_at as Date).getTime()).toBeGreaterThan(Date.now())

    h.fetchStatus = 400; h.fetchError = { code: 200 }
    h.events[0].next_attempt_at = new Date(0)
    await processConversion(h.events[0] as never)
    expect(h.events[0]).toMatchObject({ status: 'failed' })
    expect(String(h.events[0].last_error)).not.toMatch(/\(#/)
  })

  it('a row already being sent is not sent again (claimed first)', async () => {
    h.events.push({ id: 'ev-x', account_id: 'a', event_id: 'e', status: 'sending', attempts: 1, next_attempt_at: new Date(0), target: 'crm', channel: null, stage: 'raw', event_name: 'Lead', payload: {} } as Ev)
    await processConversion(h.events[0] as never)
    expect(h.fetches).toHaveLength(0)
  })
})
