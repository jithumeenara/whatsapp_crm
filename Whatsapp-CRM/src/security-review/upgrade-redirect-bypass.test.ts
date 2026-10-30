/**
 * Independent security review (A7, round 5) — attacks on the same-host
 * http→https "upgrade" exemption added to safeFetch in a7a9267, which keeps
 * the caller's headers and body across that one redirect.
 *
 * node:http / node:https are stubbed (no TLS or ports 80/443 in tests), but
 * unlike the fixer's stub this one CALLS the `lookup` option safeFetch
 * passes, so DNS answers are judged exactly as a real socket would.
 */
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeFetch, SafeFetchError, SsrfBlockedError } from '@/lib/net/safe-fetch'

type Hop = { proto: string; host: string; port: number; method: string; headers: Record<string, string>; body: string; address?: string }
let hops: Hop[] = []
let redirectTo = ''
let code = 308
let dnsAnswers: Record<string, Array<Array<{ address: string; family: number }>>> = {}

function fake(proto: 'http' | 'https') {
  return ((opts: { hostname: string; port: number; method: string; headers: Record<string, string>; lookup: typeof dns.lookup }) => {
    const req = new EventEmitter() as EventEmitter & { end: (b?: Buffer) => void; destroy: () => void }
    req.destroy = () => {}
    req.end = (b?: Buffer) => {
      const go = (address?: string) => {
        hops.push({ proto, host: opts.hostname, port: opts.port, method: opts.method, headers: { ...opts.headers }, body: b ? b.toString() : '', address })
        setImmediate(() => {
          const first = hops.length === 1
          const res = Object.assign(Readable.from(first ? [] : [Buffer.from('ok')]), {
            statusCode: first ? code : 200,
            statusMessage: '',
            headers: first ? { location: redirectTo } : {},
          })
          req.emit('response', res)
        })
      }
      // A literal address needs no lookup (node skips it too).
      if (/^[\d.]+$/.test(opts.hostname) || opts.hostname.includes(':')) return go(opts.hostname)
      ;(opts.lookup as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)(
        opts.hostname,
        { all: true },
        (err, addrs) => (err ? setImmediate(() => req.emit('error', err)) : go((addrs as Array<{ address: string }>)[0].address)),
      )
    }
    return req
  }) as unknown as typeof http.request
}

beforeEach(() => {
  hops = []
  dnsAnswers = {}
  vi.spyOn(http, 'request').mockImplementation(fake('http'))
  vi.spyOn(https, 'request').mockImplementation(fake('https'))
  vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) => {
    const queue = dnsAnswers[host]
    const answer = queue && (queue.length > 1 ? queue.shift() : queue[0])
    if (!answer) return process.nextTick(() => cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })))
    process.nextTick(() => cb(null, answer))
  }) as unknown as typeof dns.lookup)
})
afterEach(() => vi.restoreAllMocks())

const PUB = [{ address: '93.184.216.34', family: 4 }]
const send = (url: string) =>
  safeFetch(url, { method: 'POST', body: '{"secret":1}', headers: { 'x-api-key': 'tenant-key', 'content-type': 'application/json' } })

describe('upgrade exemption — cannot be abused', () => {
  it('the upgraded hop is resolved again and a private answer is refused (rebinding on upgrade)', async () => {
    dnsAnswers['hooks.example.com'] = [PUB, [{ address: '10.0.0.5', family: 4 }]]
    redirectTo = 'https://hooks.example.com/in'
    await expect(send('http://hooks.example.com/in')).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(hops).toHaveLength(1) // nothing reached the private address
  })
  it('a public upgraded hop does get the body and header (control)', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    redirectTo = 'https://hooks.example.com/in'
    await send('http://hooks.example.com/in')
    expect(hops[1]).toMatchObject({ proto: 'https', port: 443, body: '{"secret":1}' })
    expect(hops[1].headers['x-api-key']).toBe('tenant-key')
  })
  it('trailing-dot host is another site: body refused', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    dnsAnswers['hooks.example.com.'] = [PUB]
    redirectTo = 'https://hooks.example.com./in'
    await expect(send('http://hooks.example.com/in')).rejects.toThrow(/another site/)
    expect(hops).toHaveLength(1)
  })
  it('subdomain / suffix tricks are another site', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    for (const to of ['https://hooks.example.com.evil.net/in', 'https://evil-hooks.example.com/in', 'https://example.com/in']) {
      hops = []
      redirectTo = to
      await expect(send('http://hooks.example.com/in'), to).rejects.toThrow(/another site/)
    }
  })
  it('explicit :443 on the target is still the default port (WHATWG drops it) — allowed; :8443 is not', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    redirectTo = 'https://hooks.example.com:443/in'
    await send('http://hooks.example.com/in')
    expect(hops[1].headers['x-api-key']).toBe('tenant-key')
    hops = []
    redirectTo = 'https://hooks.example.com:8443/in'
    await expect(
      safeFetch('http://hooks.example.com/in', { method: 'POST', body: 'x' }, { allowedPorts: [80, 443, 8443] }),
    ).rejects.toThrow(/another site/)
  })
  it('the original on a non-default port cannot use the exemption', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    redirectTo = 'https://hooks.example.com/in'
    await expect(
      safeFetch('http://hooks.example.com:8080/in', { method: 'POST', body: 'x' }, { allowedPorts: [80, 443, 8080] }),
    ).rejects.toThrow(/another site/)
  })
  it('userinfo in the upgrade Location is refused before anything is sent', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    redirectTo = 'https://user:pw@hooks.example.com/in'
    await expect(send('http://hooks.example.com/in')).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(hops).toHaveLength(1)
  })
  it('host case is normalised (same site), and an IP literal for the same host is another site', async () => {
    dnsAnswers['hooks.example.com'] = [PUB]
    redirectTo = 'https://HOOKS.Example.COM/in'
    await send('http://hooks.example.com/in')
    expect(hops[1].headers['x-api-key']).toBe('tenant-key')
    hops = []
    redirectTo = 'https://93.184.216.34/in'
    await expect(send('http://hooks.example.com/in')).rejects.toThrow(/another site/)
  })
  it('303 turns POST into GET and drops the body; 307 PUT keeps method and body (Fetch spec)', async () => {
    dnsAnswers['api.example.com'] = [PUB]
    code = 303
    redirectTo = 'https://api.example.com/done'
    await safeFetch('http://api.example.com/x', { method: 'POST', body: 'a=1' })
    expect(hops[1]).toMatchObject({ method: 'GET', body: '' })
    expect(hops[1].headers['content-type']).toBeUndefined()
    hops = []
    code = 307
    redirectTo = 'https://api.example.com/x'
    await safeFetch('http://api.example.com/x', { method: 'PUT', body: 'b=2' })
    expect(hops[1]).toMatchObject({ method: 'PUT', body: 'b=2' })
    hops = []
    code = 302
    await safeFetch('http://api.example.com/x', { method: 'PATCH', body: 'c=3' })
    expect(hops[1]).toMatchObject({ method: 'PATCH', body: 'c=3' })
    code = 308
  })
  it('a cross-site 301 with a PUT body is refused (body kept by spec, so not sent elsewhere)', async () => {
    dnsAnswers['api.example.com'] = [PUB]
    code = 301
    redirectTo = 'https://other.example.net/x'
    await expect(safeFetch('http://api.example.com/x', { method: 'PUT', body: 'z' })).rejects.toBeInstanceOf(SafeFetchError)
    expect(hops).toHaveLength(1)
    code = 308
  })
})
