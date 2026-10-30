/**
 * N7 (security review 2026-10): on a redirect to another origin safeFetch
 * dropped only Authorization / Cookie / Proxy-Authorization, so tenant
 * secrets in custom headers (X-API-Key …) followed the redirect. Now only an
 * allow-list (accept, accept-language, accept-encoding, user-agent) goes
 * across; 301/302/303 never re-send a body; a 307/308 that would carry a
 * body to another origin is refused.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  for (const code of [301, 302, 303]) {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      it(`${code} after ${method} continues as GET without the body`, async () => {
        await safeFetch(via(code, `${A}/x`), { method, body: 'secret=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { allowedPorts: ports() })
        expect(seen.method).toBe('GET')
        expect(seen.body).toBe('')
        expect(seen.headers['content-type']).toBeUndefined()
      })
    }
  }
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
  it('a cross-origin 307 GET (no body) is followed', async () => {
    const res = await safeFetch(via(307, `${B}/x`), {}, { allowedPorts: ports() })
    expect(await res.text()).toBe('ok')
    expect(seen.method).toBe('GET')
  })
})
