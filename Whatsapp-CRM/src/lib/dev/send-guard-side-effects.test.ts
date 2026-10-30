/**
 * Bug (independent review A7, workstream D "partially fixed"): on a
 * development / test / preview / staging server the send guard stopped
 * customer *messages* only. Every other outbound side effect still went
 * out for real:
 *
 *   - outgoing tenant webhooks (Zapier / Make, which message customers),
 *   - the automation "send webhook" step,
 *   - a flow / chatbot "HTTP request" step that POSTs,
 *   - Meta writes that are not a message — Instagram / Facebook profile,
 *     ice breakers, subscriptions, any POST / DELETE to the Graph API.
 *
 * Read-only GETs (imports, integrations) and the OAuth / token endpoints
 * needed to connect an account in development must still work, and a
 * production server must behave exactly as before.
 */
import http from 'node:http'
import dns from 'node:dns'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  hooks: [] as Array<{ id: string; url: string; signing_secret: string }>,
  updates: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      findMany: async () => h.hooks,
      update: async (args: { data: Record<string, unknown> }) => {
        h.updates.push(args.data)
        return { failure_count: 1 }
      },
    },
  },
}))

import { dispatchWebhooks } from '@/lib/webhooks/deliver'
import { postAutomationWebhook } from '@/lib/automations/send-webhook'
import { runHttpNodeRequest } from '@/lib/flows/http-request-node'
import { blockedOutbound, installDevSendGuard } from './send-guard'
import { encrypt } from '@/lib/whatsapp/encryption'

// DNS is never really asked: every name "does not exist", and each ask is
// recorded. A request that reaches DNS was NOT stopped by the guard; one
// that never asks was answered before leaving. Nothing here can reach the
// internet either way.
let lookups: string[] = []
const realLookup = dns.lookup.bind(dns)
beforeAll(() => {
  vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: unknown, callback?: (...a: unknown[]) => void) => {
    const cb = (typeof options === 'function' ? options : callback) as (...a: unknown[]) => void
    if (isIP(hostname)) return realLookup(hostname, (typeof options === 'object' && options) || {}, cb as never)
    lookups.push(hostname)
    process.nextTick(() => cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })))
  }) as unknown as typeof dns.lookup)
})
beforeEach(() => {
  lookups = []
  h.updates = []
  vi.stubEnv('APP_ENV', 'development')
})
afterEach(() => vi.unstubAllEnvs())

// A local server standing in for "the developer's own endpoint".
const hits: Array<{ method: string; url: string; body: string }> = []
let server: http.Server
let base = ''
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', body })
      res.writeHead(201, { 'content-type': 'text/plain' }).end('real answer')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => {
  hits.length = 0
})

const ZAPIER = 'https://hooks.zapier.com/hooks/catch/123/abc/'

describe('outbound actions are stopped outside production', () => {
  it('an outgoing tenant webhook is not delivered, and counts as delivered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.hooks = [{ id: 'w1', url: ZAPIER, signing_secret: encrypt('s') }]
    dispatchWebhooks('a1', 'record.created', 't1', { id: 'r', data: { phone: '919800000001' }, created_at: '', updated_at: '' }, 'T')
    await vi.waitFor(() => expect(h.updates.length).toBe(1))
    expect(lookups).toEqual([])
    expect(h.updates[0]).toMatchObject({ failure_count: 0, last_response_status: 200 })
    // One line, host only — no payload, no signature, no path.
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[DEV] blocked'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('hooks.zapier.com')
    expect(lines[0]).not.toContain('/hooks/catch')
    expect(lines[0]).not.toContain('919800000001')
  })

  it('the automation "send webhook" step is not sent, and reports success', async () => {
    await expect(postAutomationWebhook(ZAPIER, { authorization: 'Bearer secret' }, '{"to":"919800000001"}')).resolves.toBe(200)
    expect(lookups).toEqual([])
  })

  it('a flow / chatbot HTTP POST step is not sent, and gets a believable reply', async () => {
    const r = await runHttpNodeRequest({ method: 'POST', url: 'https://hook.eu1.make.com/abc', headers: {}, body: '{}' })
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
    expect(() => JSON.parse(r.text)).not.toThrow()
    expect(lookups).toEqual([])
  })

  it('DELETE / PUT / PATCH steps are stopped too', async () => {
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      await expect(runHttpNodeRequest({ method, url: 'https://api.example.com/orders/1', headers: {} })).resolves.toMatchObject({ ok: true })
    }
    expect(lookups).toEqual([])
  })

  // Round 7 (R6b): a flow GET is not "a read" — catch hooks and SMS send
  // URLs fire on GET — so it is stopped too; DEV_ALLOWED_HOSTS lets it out.
  it('a flow HTTP GET is stopped too, and goes out only to a DEV_ALLOWED_HOSTS host', async () => {
    await expect(runHttpNodeRequest({ method: 'GET', url: 'https://api.example.com/orders/1', headers: {} })).resolves.toMatchObject({ ok: true, status: 200 })
    expect(lookups).toEqual([])
    vi.stubEnv('DEV_ALLOWED_HOSTS', 'api.example.com')
    await expect(runHttpNodeRequest({ method: 'GET', url: 'https://api.example.com/orders/1', headers: {} })).rejects.toThrow()
    expect(lookups).toEqual(['api.example.com'])
  })

  it('stops on staging and preview too, not only development', async () => {
    for (const env of ['staging', 'preview', 'test']) {
      vi.stubEnv('APP_ENV', env)
      await expect(postAutomationWebhook(ZAPIER, {}, '{}')).resolves.toBe(200)
    }
    expect(lookups).toEqual([])
  })

  it('a developer’s own endpoint in DEV_ALLOWED_HOSTS is really called', async () => {
    vi.stubEnv('SSRF_ALLOW_PRIVATE', '1')
    const blocked = await runHttpNodeRequest({ method: 'POST', url: `${base}/mine`, headers: {}, body: '{"a":1}' })
    expect(blocked.ok).toBe(true)
    expect(hits).toEqual([])

    vi.stubEnv('DEV_ALLOWED_HOSTS', ' webhook.site , 127.0.0.1 ')
    const real = await runHttpNodeRequest({ method: 'POST', url: `${base}/mine`, headers: {}, body: '{"a":1}' })
    expect(real).toEqual({ status: 201, ok: true, text: 'real answer' })
    expect(hits).toEqual([{ method: 'POST', url: '/mine', body: '{"a":1}' }])
  })

  it('DEV_ALLOWED_HOSTS is an exact host list, not a suffix match', async () => {
    vi.stubEnv('DEV_ALLOWED_HOSTS', 'zapier.com')
    await expect(postAutomationWebhook(ZAPIER, {}, '{}')).resolves.toBe(200)
    expect(lookups).toEqual([])
  })

  it('DEV_ALLOW_SENDING=1 lets everything out', async () => {
    vi.stubEnv('DEV_ALLOW_SENDING', '1')
    await expect(postAutomationWebhook(ZAPIER, {}, '{}')).rejects.toThrow()
    expect(lookups).toEqual(['hooks.zapier.com'])
  })

  it('production is untouched: the same POST reaches the endpoint byte for byte', async () => {
    // A server whose environment says nothing (APP_ENV unset, not a test run).
    vi.stubEnv('APP_ENV', '')
    vi.stubEnv('VITEST', '')
    vi.stubEnv('NODE_ENV', 'development') // so the local test server may be reached at all
    vi.stubEnv('SSRF_ALLOW_PRIVATE', '1')
    const r = await runHttpNodeRequest({ method: 'POST', url: `${base}/prod?x=1`, headers: {}, body: '{"to":"919800000001"}' })
    expect(r).toEqual({ status: 201, ok: true, text: 'real answer' })
    expect(hits).toEqual([{ method: 'POST', url: '/prod?x=1', body: '{"to":"919800000001"}' }])
  })
})

describe('Meta writes that are not messages are stopped outside production', () => {
  const realFetch = globalThis.fetch
  const network = vi.fn(async () => Response.json({ real: true }))
  beforeAll(() => {
    globalThis.fetch = network as unknown as typeof fetch
    installDevSendGuard()
  })
  afterAll(() => {
    globalThis.fetch = realFetch
  })
  beforeEach(() => {
    network.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const writes: Array<[string, string]> = [
    ['POST', 'https://graph.instagram.com/v21.0/me/messenger_profile?access_token=x'], // ice breakers
    ['DELETE', 'https://graph.instagram.com/v21.0/me/messenger_profile?access_token=x'],
    ['POST', 'https://graph.facebook.com/v21.0/1234567890/whatsapp_business_profile'], // profile write
    ['POST', 'https://graph.facebook.com/v21.0/998877/subscribed_apps'],
    ['DELETE', 'https://graph.facebook.com/v21.0/998877/subscribed_apps'],
    ['POST', 'https://graph.facebook.com/v21.0/1234567890/register'],
    ['POST', 'https://graph.facebook.com/v21.0/17841400000000/media_publish'],
    ['POST', 'https://graph.facebook.com/v21.0/123_456/comments'],
    ['POST', 'https://graph.facebook.com/v21.0/'], // a Graph batch
    ['GET', 'https://graph.facebook.com/v21.0/123_456?method=delete&access_token=x'], // method override
  ]
  for (const [method, url] of writes) {
    it(`${method} ${url.replace(/\?.*/, '')} is answered without leaving`, async () => {
      const res = await fetch(url, { method, body: method === 'GET' ? undefined : '{"message":"hi"}' })
      expect(network).not.toHaveBeenCalled()
      expect(res.ok).toBe(true)
      expect(await res.json()).toMatchObject({ success: true })
    })
  }

  it('logs one line with the host only — no path, token or body', async () => {
    const warn = vi.mocked(console.warn)
    await fetch('https://graph.facebook.com/v21.0/1234567890/whatsapp_business_profile?access_token=SECRET', { method: 'POST', body: '{"about":"x"}' })
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[DEV] blocked'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('graph.facebook.com')
    expect(lines[0]).not.toContain('SECRET')
    expect(lines[0]).not.toContain('whatsapp_business_profile')
    expect(lines[0]).not.toContain('about')
  })

  const connect: Array<[string, string]> = [
    ['GET', 'https://graph.facebook.com/v21.0/oauth/access_token?client_id=1&client_secret=s&code=c'],
    ['POST', 'https://graph.facebook.com/v21.0/oauth/access_token'],
    ['GET', 'https://graph.facebook.com/debug_token?input_token=x&access_token=y'],
    ['POST', 'https://graph.facebook.com/v21.0/debug_token'],
    ['POST', 'https://api.instagram.com/oauth/access_token'],
    ['GET', 'https://graph.instagram.com/access_token?grant_type=ig_exchange_token'],
    ['GET', 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token'],
    ['GET', 'https://graph.instagram.com/v21.0/me?fields=id,username'],
    ['GET', 'https://graph.facebook.com/v21.0/me/accounts'],
  ]
  for (const [method, url] of connect) {
    it(`${method} ${url.replace(/\?.*/, '')} still goes out (connecting an account, reads)`, async () => {
      await fetch(url, { method, body: method === 'GET' ? undefined : 'code=c' })
      expect(network).toHaveBeenCalledTimes(1)
    })
  }

  it('a message to an allowed recipient still goes out (Meta write rule does not override it)', async () => {
    vi.stubEnv('DEV_ALLOWED_RECIPIENTS', '919800000001')
    await fetch('https://graph.facebook.com/v21.0/1234567890/messages', { method: 'POST', body: JSON.stringify({ to: '919800000001' }) })
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('DEV_ALLOWED_HOSTS does not unlock customer messages', async () => {
    vi.stubEnv('DEV_ALLOWED_HOSTS', 'graph.facebook.com')
    await fetch('https://graph.facebook.com/v21.0/1234567890/messages', { method: 'POST', body: JSON.stringify({ to: '919800000002' }) })
    expect(network).not.toHaveBeenCalled()
    await fetch('https://graph.facebook.com/v21.0/1234567890/whatsapp_business_profile', { method: 'POST', body: '{}' })
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('production is untouched: the same request is passed to fetch unchanged', async () => {
    vi.stubEnv('APP_ENV', '')
    vi.stubEnv('VITEST', '')
    vi.stubEnv('NODE_ENV', 'production')
    const url = 'https://graph.instagram.com/v21.0/me/messenger_profile?access_token=x'
    const init = { method: 'POST', body: '{"ice_breakers":[]}', headers: { 'content-type': 'application/json' } }
    const res = await fetch(url, init)
    expect(network).toHaveBeenCalledTimes(1)
    expect(network.mock.calls[0]).toEqual([url, init])
    expect((network.mock.calls[0] as unknown[])[1]).toBe(init)
    expect(await res.json()).toEqual({ real: true })
  })
})

describe('blockedOutbound — the rule itself', () => {
  const PROD_ENVS = [{}, { NODE_ENV: 'production' }, { APP_ENV: 'production', NODE_ENV: 'production' }]
  const CASES: Array<[string, string, { purpose?: 'outbound-action' }]> = [
    ['POST', ZAPIER, { purpose: 'outbound-action' }],
    ['DELETE', 'https://api.example.com/x', { purpose: 'outbound-action' }],
    ['POST', 'https://graph.instagram.com/v21.0/me/messenger_profile', {}],
    ['DELETE', 'https://graph.facebook.com/v21.0/1/subscribed_apps', {}],
    ['POST', 'https://graph.facebook.com/v21.0/1/messages', {}],
  ]
  it('returns null for every case on a production server', () => {
    for (const env of PROD_ENVS) for (const [m, u, o] of CASES) expect(blockedOutbound(u, m, '{"to":"1"}', env, o), `${m} ${u}`).toBeNull()
  })
  it('stops every case on staging', () => {
    for (const [m, u, o] of CASES) expect(blockedOutbound(u, m, '{"to":"1"}', { APP_ENV: 'staging', NODE_ENV: 'production' }, o), `${m} ${u}`).not.toBeNull()
  })
  it('without the purpose flag, a non-Meta POST is left to the message rules (no URL guessing)', () => {
    expect(blockedOutbound(ZAPIER, 'POST', '{}', { APP_ENV: 'development' })).toBeNull()
  })
  it('a lookalike Meta host is not treated as Meta', () => {
    expect(blockedOutbound('https://graph.facebook.com.evil.example/v21.0/1/x', 'POST', '{}', { APP_ENV: 'development' })).toBeNull()
  })
})
