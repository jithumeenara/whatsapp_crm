import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: a lead marked qualified (or a deal won) twice — a double press, a
 * retry, or reopened and closed again — reported the same outcome to Meta
 * twice, because the Conversions API event had no event_id to dedupe on.
 * Meta then counted two results for one customer and optimised on it.
 */

const sent = vi.hoisted(() => ({ bodies: [] as unknown[], events: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdsConfig: { findUnique: () => Promise.resolve({ status: 'connected', dataset_id: 'ds1', access_token: 'enc', waba_id: 'w1' }) },
    conversation: { findFirst: () => Promise.resolve({ ctwa_clid: 'clid-1', channel: 'whatsapp' }) },
    $queryRaw: () => Promise.resolve([]),
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }))

afterEach(() => { vi.unstubAllGlobals(); sent.bodies = []; sent.events = [] })

describe('Conversions API event_id', () => {
  it('sendBusinessMessagingEvent puts the event_id on the event', async () => {
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => { sent.bodies.push(JSON.parse(init.body)); return Promise.resolve(new Response('{}', { status: 200 })) })
    const { sendBusinessMessagingEvent } = await import('./api')
    await sendBusinessMessagingEvent({ datasetId: 'ds1', accessToken: 't', eventName: 'QualifiedLead', eventTime: 1, wabaId: 'w1', ctwaClid: 'c', eventId: 'qualified:lead:L1' })
    expect((sent.bodies[0] as { data: Array<{ event_id?: string }> }).data[0].event_id).toBe('qualified:lead:L1')
  })

  it('the same outcome reported twice carries the same event_id, so Meta counts it once', async () => {
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => { sent.bodies.push(JSON.parse(init.body)); return Promise.resolve(new Response('{}', { status: 200 })) })
    const { reportMetaAdsOutcome } = await import('./triggers')
    await reportMetaAdsOutcome({ accountId: 'a', contactId: 'c', eventName: 'QualifiedLead', record: { kind: 'lead', id: 'L1' } })
    await reportMetaAdsOutcome({ accountId: 'a', contactId: 'c', eventName: 'QualifiedLead', record: { kind: 'lead', id: 'L1' } })
    const ids = sent.bodies.map((b) => (b as { data: Array<{ event_id?: string }> }).data[0].event_id)
    expect(ids).toEqual(['qualifiedlead:lead:L1', 'qualifiedlead:lead:L1'])
  })

  it('outcomeEventId is stable per record and kind', async () => {
    const { outcomeEventId } = await import('./triggers')
    expect(outcomeEventId('QualifiedLead', 'lead', 'L1')).toBe('qualifiedlead:lead:L1')
    expect(outcomeEventId('Purchase', 'deal', 'D9')).toBe(outcomeEventId('Purchase', 'deal', 'D9'))
    expect(outcomeEventId('Purchase', 'deal', 'D9')).not.toBe(outcomeEventId('Purchase', 'deal', 'D8'))
  })
})
