/**
 * N7 (security review 2026-10): on a redirect to another origin safeFetch
 * dropped only Authorization / Cookie / Proxy-Authorization, so tenant
 * secrets in custom headers (X-API-Key …) followed the redirect. Now only an
 * allow-list (accept, accept-language, accept-encoding, user-agent) goes
 * across; a redirect that would carry a body to another site is refused.
 * Round 5: methods are rewritten as the Fetch spec says (303 → GET, 301/302
 * → GET only after POST), and a same-host http→https upgrade counts as the
 * same site.
 */
import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeFetch, SafeFetchError } from './safe-fetch'

type Seen = { method?: string; headers: http.IncomingHttpHeaders; body: string }
let seen: Seen = { headers: {}, body: '' }
let a: http.Server
let b: http.Server
let A = ''
let B = ''

const record = (req: http.IncomingMessage, res: http.ServerResponse) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen = { method: req.method, headers: req.headers, body }
    res.end('ok')
  })
}

beforeAll(async () => {
  b = http.createServer(record)
  await new Promise<void>((r) => b.listen(0, '127.0.0.1', r))
  B = `http://localhost:${(b.address() as AddressInfo).port}`
  a = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const code = Number(u.searchParams.get('code'))
    if (u.pathname === '/r') {
      req.resume()
      res.writeHead(code, { location: u.searchParams.get('u') ?? '/' })
      return res.end()
    }
    record(req, res)
  })
  await new Promise<void>((r) => a.listen(0, '127.0.0.1', r))
  A = `http://127.0.0.1:${(a.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((r) => a.close(r))
  await new Promise((r) => b.close(r))
})
beforeEach(() => {
  process.env.SSRF_ALLOW_PRIVATE = '1'
  seen = { headers: {}, body: '' }
})

const ports = () => [Number(new URL(A).port), Number(new URL(B).port)]
const via = (code: number, to: string) => `${A}/r?code=${code}&u=${encodeURIComponent(to)}`

describe('safeFetch redirects — headers across origins', () => {
  it('keeps only accept / accept-language / user-agent on a cross-origin hop', async () => {
    await safeFetch(via(302, `${B}/x`), {
      headers: {
        accept: 'application/json',
        'accept-language': 'en',
        'user-agent': 'crm',
        'x-api-key': 'tenant-secret',
        'api-key': 'k',
        'x-auth-token': 't',
        authorization: 'Bearer s',
        cookie: 'sid=1',
      },
    }, { allowedPorts: ports() })
    expect(seen.headers.accept).toBe('application/json')
    expect(seen.headers['accept-language']).toBe('en')
    expect(seen.headers['user-agent']).toBe('crm')
    for (const h of ['x-api-key', 'api-key', 'x-auth-token', 'authorization', 'cookie']) {
      expect(seen.headers[h], h).toBeUndefined()
    }
  })
  it('a same-origin redirect keeps the caller’s headers', async () => {
    await safeFetch(via(302, `${A}/x`), { headers: { 'x-api-key': 'k' } }, { allowedPorts: ports() })
    expect(seen.headers['x-api-key']).toBe('k')
  })
})

describe('safeFetch redirects — bodies', () => {
  // Round 5: method rewriting follows the Fetch spec (the owner's
  // decision; round 4 turned every 301/302 into a GET, which made a
  // `DELETE http://…` that 301s to https quietly do a GET instead).
  // 303 → GET for everything but HEAD; 301/302 → GET only after POST.
  const rewritten: Array<[number, string]> = [[303, 'POST'], [303, 'PUT'], [303, 'PATCH'], [303, 'DELETE'], [301, 'POST'], [302, 'POST']]
  for (const [code, method] of rewritten) {
    it(`${code} after ${method} continues as GET without the body`, async () => {
      await safeFetch(via(code, `${A}/x`), { method, body: 'secret=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { allowedPorts: ports() })
      expect(seen.method).toBe('GET')
      expect(seen.body).toBe('')
      expect(seen.headers['content-type']).toBeUndefined()
    })
  }
  for (const code of [301, 302]) {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      it(`a same-origin ${code} after ${method} keeps the method and the body`, async () => {
        await safeFetch(via(code, `${A}/x`), { method, body: 'v=1', headers: { 'content-type': 'text/plain', 'x-api-key': 'k' } }, { allowedPorts: ports() })
        expect(seen.method).toBe(method)
        expect(seen.body).toBe('v=1')
        expect(seen.headers['content-type']).toBe('text/plain')
        expect(seen.headers['x-api-key']).toBe('k')
      })
      it(`a cross-origin ${code} after ${method} with a body is refused`, async () => {
        await expect(
          safeFetch(via(code, `${B}/x`), { method, body: 'v=1' }, { allowedPorts: ports() }),
        ).rejects.toBeInstanceOf(SafeFetchError)
        expect(seen.body).toBe('')
      })
    }
  }
  it('303 after HEAD stays HEAD', async () => {
    await safeFetch(via(303, `${A}/x`), { method: 'HEAD' }, { allowedPorts: ports() })
    expect(seen.method).toBe('HEAD')
  })
  it('a same-origin 307 keeps method and body', async () => {
    await safeFetch(via(307, `${A}/x`), { method: 'POST', body: 'a=1' }, { allowedPorts: ports() })
    expect(seen.method).toBe('POST')
    expect(seen.body).toBe('a=1')
  })
  for (const code of [307, 308]) {
    it(`a cross-origin ${code} carrying a body is refused, nothing reaches the other site`, async () => {
      await expect(
        safeFetch(via(code, `${B}/x`), { method: 'POST', body: 'token=abc' }, { allowedPorts: ports() }),
      ).rejects.toBeInstanceOf(SafeFetchError)
      expect(seen.body).toBe('')
    })
  }
  it('the refusal says the URL redirects to another site and should be updated', async () => {
    await expect(
      safeFetch(via(308, `${B}/x`), { method: 'POST', body: 'token=abc', headers: { 'x-api-key': 'k' } }, { allowedPorts: ports() }),
    ).rejects.toThrow(/redirects to another site.*update/i)
    expect(seen.body).toBe('')
  })
  it('a cross-origin 307 GET (no body) is followed', async () => {
    const res = await safeFetch(via(307, `${B}/x`), {}, { allowedPorts: ports() })
    expect(await res.text()).toBe('ok')
    expect(seen.method).toBe('GET')
  })
})

/**
 * Round 5: http→https on the same host is the same site. Many hosts
 * (Vercel, Cloudflare, Next) answer `http://` with a 307/308 to `https://`;
 * round 4 counted the scheme change as another origin, so a saved http://
 * webhook POST was refused and an integration GET lost its X-API-Key.
 *
 * The test servers above cannot listen on 80/443 or speak TLS, so these
 * stand in for node:http / node:https and record every hop's request.
 */
describe('safeFetch redirects — same-host http→https upgrade', () => {
  type Hop = { proto: string; host: string; port: number; method: string; headers: Record<string, string>; body: string }
  let hops: Hop[] = []
  let redirect: { code: number; to: string } = { code: 308, to: '' }

  function fake(proto: 'http' | 'https') {
    return ((opts: { hostname: string; port: number; method: string; headers: Record<string, string> }) => {
      const req = new EventEmitter() as EventEmitter & { end: (b?: Buffer) => void; destroy: () => void }
      req.destroy = () => {}
      req.end = (b?: Buffer) => {
        hops.push({ proto, host: opts.hostname, port: opts.port, method: opts.method, headers: opts.headers, body: b ? b.toString() : '' })
        setImmediate(() => {
          const first = hops.length === 1
          const res = Object.assign(Readable.from(first ? [] : [Buffer.from('ok')]), {
            statusCode: first ? redirect.code : 200,
            statusMessage: '',
            headers: first ? { location: redirect.to } : {},
          })
          req.emit('response', res)
        })
      }
      return req
    }) as unknown as typeof http.request
  }

  beforeEach(() => {
    hops = []
    vi.spyOn(http, 'request').mockImplementation(fake('http'))
    vi.spyOn(https, 'request').mockImplementation(fake('https'))
  })
  afterEach(() => vi.restoreAllMocks())

  it('a 308 POST with X-API-Key to https on the same host keeps body and header', async () => {
    redirect = { code: 308, to: 'https://hooks.example.com/in' }
    const res = await safeFetch('http://hooks.example.com/in', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json', 'x-api-key': 'tenant-key' },
    })
    expect(await res.text()).toBe('ok')
    expect(hops).toHaveLength(2)
    expect(hops[1]).toMatchObject({ proto: 'https', host: 'hooks.example.com', port: 443, method: 'POST', body: '{"a":1}' })
    expect(hops[1].headers['x-api-key']).toBe('tenant-key')
    expect(hops[1].headers['content-type']).toBe('application/json')
  })
  it('a 307 GET upgrade keeps X-API-Key (integration-fetch)', async () => {
    redirect = { code: 307, to: 'https://api.example.com/v1' }
    await safeFetch('http://api.example.com/v1', { headers: { 'x-api-key': 'k' } })
    expect(hops[1].headers['x-api-key']).toBe('k')
  })
  it('a 301 DELETE upgrade stays a DELETE', async () => {
    redirect = { code: 301, to: 'https://api.example.com/item/1' }
    await safeFetch('http://api.example.com/item/1', { method: 'DELETE' })
    expect(hops[1].method).toBe('DELETE')
  })
  it('a 308 POST to https on ANOTHER host is refused; nothing is sent there', async () => {
    redirect = { code: 308, to: 'https://elsewhere.example.net/in' }
    await expect(
      safeFetch('http://hooks.example.com/in', { method: 'POST', body: 'x=1', headers: { 'x-api-key': 'k' } }),
    ).rejects.toThrow(/redirects to another site/)
    expect(hops).toHaveLength(1)
  })
  it('a non-default port is not an upgrade: headers are stripped', async () => {
    redirect = { code: 307, to: 'https://api.example.com:8443/v1' }
    await safeFetch('http://api.example.com/v1', { headers: { 'x-api-key': 'k' } }, { allowedPorts: [80, 443, 8443] })
    expect(hops[1].headers['x-api-key']).toBeUndefined()
  })
  it('https→http (a downgrade) is not the same site: headers are stripped', async () => {
    redirect = { code: 307, to: 'http://api.example.com/v1' }
    await safeFetch('https://api.example.com/v1', { headers: { 'x-api-key': 'k' } })
    expect(hops[1].headers['x-api-key']).toBeUndefined()
  })
  it('the upgraded hop still goes through the address checks', async () => {
    process.env.SSRF_ALLOW_PRIVATE = ''
    redirect = { code: 308, to: 'https://127.0.0.1/x' }
    await expect(safeFetch('http://127.0.0.1/x', {})).rejects.toBeInstanceOf(SafeFetchError)
    expect(hops).toHaveLength(0)
    redirect = { code: 308, to: 'https://169.254.169.254/latest' }
    await expect(safeFetch('http://hooks.example.com/x', {})).rejects.toBeInstanceOf(SafeFetchError)
    expect(hops).toHaveLength(1)
  })
})
