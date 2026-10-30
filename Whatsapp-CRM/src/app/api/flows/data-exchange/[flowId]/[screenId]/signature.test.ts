import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A9-08: the WhatsApp Flows data-exchange endpoint trusted any request
 * that was encrypted to the account's RSA public key — and a public key
 * is not a secret. Meta signs every endpoint request with the app secret
 * (`X-Hub-Signature-256`, HMAC-SHA256 of the raw body) and asks for HTTP
 * 432 when the signature does not match. Both Meta-facing URLs
 * (/api/flows/data-exchange/... and /api/flows/[id]/webhook) must check it
 * before anything is decrypted or written.
 */

const h = vi.hoisted(() => ({ handled: [] as Array<{ flowId: string; body: string }> }))

vi.mock('@/lib/whatsapp/webhook-secrets', () => ({ whatsappWebhookSecrets: async () => ['app-secret'] }))
vi.mock('@/lib/flows/webhook-handler', () => ({
  debugLog: new Map(),
  handleFlowWebhookPost: vi.fn(async (req: Request, flowId: string) => {
    h.handled.push({ flowId, body: await req.text() })
    return new Response('ok', { status: 200 })
  }),
}))
vi.mock('@/lib/auth/account', () => ({ requireRole: vi.fn(), toErrorResponse: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {} }))

import { POST as dataExchangePOST } from './route'
import { POST as webhookPOST } from '../../../[id]/webhook/route'

const body = JSON.stringify({ encrypted_aes_key: 'a', encrypted_flow_data: 'b', initial_vector: 'c' })
const sign = (raw: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
const req = (signature?: string) =>
  new Request('https://x.test/api/flows/data-exchange/f1/S1', {
    method: 'POST',
    body,
    headers: signature ? { 'x-hub-signature-256': signature } : {},
  })

const routes = [
  ['data-exchange', (r: Request) => dataExchangePOST(r, { params: Promise.resolve({ flowId: 'f1', screenId: 'S1' }) })],
  ['[id]/webhook', (r: Request) => webhookPOST(r, { params: Promise.resolve({ id: 'f1' }) })],
] as const

beforeEach(() => { h.handled = [] })
afterEach(() => { delete process.env.META_FLOWS_SIGNATURE })

describe.each(routes)('Flows endpoint signature — %s', (_name, post) => {
  it('turns away an unsigned request with 432, before decrypting', async () => {
    const res = await post(req())
    expect(res.status).toBe(432)
    expect(h.handled).toEqual([])
  })

  it('turns away a request signed with another secret', async () => {
    const res = await post(req(sign(body, 'someone-else')))
    expect(res.status).toBe(432)
    expect(h.handled).toEqual([])
  })

  it('passes a request signed with the app secret, body unchanged', async () => {
    const res = await post(req(sign(body, 'app-secret')))
    expect(res.status).toBe(200)
    expect(h.handled).toEqual([{ flowId: 'f1', body }])
  })

  it('META_FLOWS_SIGNATURE=observe lets a bad one through (rollout switch)', async () => {
    process.env.META_FLOWS_SIGNATURE = 'observe'
    const res = await post(req())
    expect(res.status).toBe(200)
    expect(h.handled).toHaveLength(1)
  })
})
