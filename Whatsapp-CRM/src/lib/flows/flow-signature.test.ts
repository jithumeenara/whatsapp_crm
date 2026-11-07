import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Seen live: every WhatsApp Flows endpoint request was signed by a
 * different Meta app from the one delivering the WhatsApp webhook (the
 * Flow is connected to its own app), so all of them failed the signature
 * check and Flows worked only because observe mode let them through.
 * META_FLOWS_APP_SECRET is that app's secret: accepted for the Flows
 * endpoint only, never for the WhatsApp webhook.
 */

vi.mock('@/lib/whatsapp/webhook-secrets', () => ({ whatsappWebhookSecrets: async () => ['webhook-app-secret'] }))

import { checkFlowRequestSignature } from './flow-signature'

const body = JSON.stringify({ encrypted_flow_data: 'x' })
const sign = (secret: string) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
const req = (sig: string) => new Request('http://x/api/flows/data-exchange', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body })

describe('Flows endpoint signature', () => {
  beforeEach(() => {
    delete process.env.META_FLOWS_SIGNATURE
    delete process.env.META_FLOWS_APP_SECRET
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('accepts a request signed with the WhatsApp webhook app secret', async () => {
    expect((await checkFlowRequestSignature(req(sign('webhook-app-secret')))).response).toBeUndefined()
  })

  it('turns away a request signed by the Flow’s own app when its secret is not configured', async () => {
    const r = await checkFlowRequestSignature(req(sign('flow-app-secret')))
    expect(r.response?.status).toBe(432)
  })

  it('accepts it once META_FLOWS_APP_SECRET holds that app’s secret, passing the body on unchanged', async () => {
    process.env.META_FLOWS_APP_SECRET = 'flow-app-secret'
    const r = await checkFlowRequestSignature(req(sign('flow-app-secret')))
    expect(r.response).toBeUndefined()
    expect(await r.request?.text()).toBe(body)
  })

  it('still turns away a request signed with anything else', async () => {
    process.env.META_FLOWS_APP_SECRET = 'flow-app-secret'
    expect((await checkFlowRequestSignature(req(sign('attacker')))).response?.status).toBe(432)
  })
})
