/**
 * Independent security review (A7, 2026-10) — attempts to get past
 * src/lib/net/safe-fetch.ts. Every passing test asserts the SECURE
 * behaviour. A confirmed gap is written as `it.fails(...)` with a comment
 * so the suite stays green while the hole is documented; when the gap is
 * fixed, vitest will report the it.fails as unexpectedly passing — turn it
 * into a plain `it` then.
 *
 * DNS is never really asked: dns.lookup is replaced per test.
 */
import http from 'node:http'
import dns from 'node:dns'
import zlib from 'node:zlib'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertPublicUrl, isBlockedAddress, safeFetch, SafeFetchError, SsrfBlockedError } from '@/lib/net/safe-fetch'

const realLookup = dns.lookup.bind(dns)
type Answer = Array<{ address: string; family: 4 | 6 }>

/** Point names at addresses. A function entry is asked on every lookup. */
function fakeDns(table: Record<string, Answer | (() => Answer)>) {
  return vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (...a: unknown[]) => void
    const opts = (typeof options === 'object' && options) || {}
    if (isIP(hostname)) return realLookup(hostname, opts as dns.LookupOptions, cb as never)
    const entry = table[hostname]
    const answer = typeof entry === 'function' ? entry() : entry
    if (!answer) {
      process.nextTick(() => cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })))
      return
    }
    process.nextTick(() =>
      (opts as { all?: boolean }).all ? cb(null, answer) : cb(null, answer[0].address, answer[0].family),
    )
  }) as unknown as typeof dns.lookup)
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.SSRF_ALLOW_PRIVATE
})

describe('address policy — every private / reserved spelling is refused', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.170', '100.100.100.200',
    '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe',
    '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b:1::1', '2002:7f00:1::1',
    '2002:a9fe:a9fe::', '2001::1', '2001:db8::1', 'fc00::1', 'fd00::1', 'fd00:ec2::254', 'fe80::1',
    'fe80::1%eth0', 'fec0::1', 'ff02::1', '::ffff:0:7f00:1', '100::1', 'not-an-ip', '',
  ]
  for (const ip of blocked) {
    it(`blocks ${JSON.stringify(ip)}`, () => expect(isBlockedAddress(ip)).toBe(true))
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '64:ff9b::808:808', '172.32.0.1', '100.128.0.1']) {
    it(`allows public ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false))
  }
})

describe('URL spellings are judged after normalisation (no DNS involved)', () => {
  const urls = [
    'http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f.1/', 'http://127.1/', 'http://0x7f000001/',
    'http://017700000001/', 'http://%31%32%37.0.0.1/', 'http://0/', 'http://0.0.0.0/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',
    'http://[64:ff9b::a9fe:a9fe]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/', 'http://[::ffff:169.254.169.254]/',
    'http://localhost/', 'http://LOCALHOST./', 'http://localhost./', 'http://a.b.localhost/',
  ]
  for (const u of urls) {
    it(`refuses ${u}`, async () => {
      fakeDns({}) // a literal must never need DNS; a name gets NXDOMAIN
      await expect(assertPublicUrl(u)).rejects.toBeInstanceOf(SsrfBlockedError)
    })
  }
  it('refuses userinfo tricks, other schemes and other ports', async () => {
    fakeDns({ 'evil.example': [{ address: '93.184.216.34', family: 4 }] })
    for (const u of [
      'http://evil@127.0.0.1/', 'http://127.0.0.1:80@evil.example/', 'http://user:pw@evil.example/',
      'file:///etc/passwd', 'gopher://evil.example/', 'ftp://evil.example/', 'http://evil.example:22/',
      'http://evil.example:6379/', 'http://[fe80::1%25eth0]/',
    ]) {
      await expect(assertPublicUrl(u), u).rejects.toBeInstanceOf(SafeFetchError)
    }
  })
  it('refuses a name whose DNS answer is (or contains) a private address', async () => {
    fakeDns({
      'metadata.google.internal': [{ address: '169.254.169.254', family: 4 }],
      'mixed.example': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }],
      'v6.example': [{ address: '2606:4700::1', family: 6 }, { address: '::ffff:127.0.0.1', family: 6 }],
      '127.0.0.1.nip.io': [{ address: '127.0.0.1', family: 4 }],
    })
    for (const u of ['http://metadata.google.internal/', 'http://mixed.example/', 'http://v6.example/', 'http://127.0.0.1.nip.io/']) {
      await expect(assertPublicUrl(u), u).rejects.toBeInstanceOf(SsrfBlockedError)
    }
  })
})

describe('DNS rebinding — the connected address is the checked one', () => {
  it('a name that was public at save time and private at fetch time is refused at connect', async () => {
    let calls = 0
    const lookup = fakeDns({
      'rebind.example': () => (++calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]),
    })
    await expect(assertPublicUrl('http://rebind.example/')).resolves.toBeInstanceOf(URL)
    await expect(safeFetch('http://rebind.example/')).rejects.toBeInstanceOf(SsrfBlockedError)
    // exactly one more resolution — the one inside the socket's lookup
    expect(lookup.mock.calls.filter((c) => c[0] === 'rebind.example').length).toBe(2)
  })
  it('happy-eyeballs with one private answer among several is refused outright', async () => {
    fakeDns({ 'multi.example': [{ address: '2606:4700::1', family: 6 }, { address: '127.0.0.1', family: 4 }] })
    await expect(safeFetch('https://multi.example/')).rejects.toBeInstanceOf(SsrfBlockedError)
  })
})

// ── Live redirects against a local server (private hatch on, as in dev) ──

let server: http.Server
let base = ''
let other: http.Server
let otherBase = ''
let seenHeaders: http.IncomingHttpHeaders = {}

beforeAll(async () => {
  other = http.createServer((req, res) => {
    seenHeaders = req.headers
    res.end('ok')
  })
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r))
  otherBase = `http://localhost:${(other.address() as AddressInfo).port}`
  server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/to') {
      res.writeHead(302, { location: u.searchParams.get('u') ?? '/' })
      return res.end()
    }
    if (u.pathname === '/loop') {
      res.writeHead(302, { location: '/loop' })
      return res.end()
    }
    if (u.pathname === '/bomb') {
      // 64 MB of zeros, ~64 KB on the wire
      const gz = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024))
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' })
      return res.end(gz)
    }
    if (u.pathname === '/chunked') {
      res.writeHead(200, { 'content-type': 'text/plain' }) // no content-length → chunked
      const chunk = Buffer.alloc(64 * 1024, 97)
      let sent = 0
      const pump = () => {
        while (sent < 8 * 1024 * 1024) {
          sent += chunk.length
          if (!res.write(chunk)) return res.once('drain', pump)
        }
        res.end()
      }
      return pump()
    }
    if (u.pathname === '/slow') return // never answers
    res.end('hello')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await new Promise((r) => other.close(r))
})

const ports = () => [Number(new URL(base).port), Number(new URL(otherBase).port)]

describe('redirects', () => {
  it('a redirect to cloud metadata is refused even with SSRF_ALLOW_PRIVATE=1', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    await expect(
      safeFetch(`${base}/to?u=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`, {}, { allowedPorts: [...ports(), 80] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(
      safeFetch(`${base}/to?u=${encodeURIComponent('http://[::ffff:a9fe:a9fe]/')}`, {}, { allowedPorts: [...ports(), 80] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
  it('without the hatch, the private test server itself is refused', async () => {
    await expect(safeFetch(`${base}/`, {}, { allowedPorts: ports() })).rejects.toBeInstanceOf(SsrfBlockedError)
  })
  it('a redirect to a non-http scheme is refused', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    for (const target of ['file:///etc/passwd', 'gopher://127.0.0.1:6379/_INFO', 'data:text/plain,hi', 'javascript:alert(1)']) {
      await expect(
        safeFetch(`${base}/to?u=${encodeURIComponent(target)}`, {}, { allowedPorts: ports() }),
        target,
      ).rejects.toBeInstanceOf(SsrfBlockedError)
    }
  })
  it('a redirect to a port nobody allowed is refused', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    await expect(
      safeFetch(`${base}/to?u=${encodeURIComponent('http://127.0.0.1:5432/')}`, {}, { allowedPorts: [Number(new URL(base).port)] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
  it('a redirect loop ends with a redirects error', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    await expect(safeFetch(`${base}/loop`, {}, { allowedPorts: ports() })).rejects.toMatchObject({ reason: 'redirects' })
  })
  it('Authorization and Cookie are dropped when a redirect changes origin', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    seenHeaders = {}
    const res = await safeFetch(
      `${base}/to?u=${encodeURIComponent(`${otherBase}/x`)}`,
      { headers: { authorization: 'Bearer s3cret', cookie: 'sid=1' } },
      { allowedPorts: ports() },
    )
    expect(await res.text()).toBe('ok')
    expect(seenHeaders.authorization).toBeUndefined()
    expect(seenHeaders.cookie).toBeUndefined()
  })
  // GAP (LOW): only authorization / cookie / proxy-authorization are
  // stripped on a cross-origin redirect. Integrations and the Flows HTTP
  // node send tenant secrets in custom headers (X-API-Key, api-key,
  // X-Auth-Token …) and follow redirects, so a compromised or malicious
  // upstream that redirects elsewhere receives them. Fix: drop every
  // caller-supplied header except a small allow-list (accept,
  // content-type, user-agent) on an origin change, or default these
  // callers to redirect:'error'.
  it('custom credential headers (X-API-Key) are dropped when a redirect changes origin', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    seenHeaders = {}
    await safeFetch(
      `${base}/to?u=${encodeURIComponent(`${otherBase}/x`)}`,
      { headers: { 'x-api-key': 'tenant-secret' } },
      { allowedPorts: ports() },
    )
    expect(seenHeaders['x-api-key']).toBeUndefined()
  })
})

describe('size and time limits', () => {
  it('a gzip bomb is cut off at maxBytes after decompression', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    const res = await safeFetch(`${base}/bomb`, {}, { allowedPorts: ports(), maxBytes: 1024 * 1024 })
    await expect(res.arrayBuffer()).rejects.toMatchObject({ reason: 'size' })
  })
  it('a chunked body with no content-length is cut off at maxBytes', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    const res = await safeFetch(`${base}/chunked`, {}, { allowedPorts: ports(), maxBytes: 512 * 1024 })
    await expect(res.arrayBuffer()).rejects.toMatchObject({ reason: 'size' })
  })
  it('a server that never answers times out', async () => {
    process.env.SSRF_ALLOW_PRIVATE = '1'
    await expect(safeFetch(`${base}/slow`, {}, { allowedPorts: ports(), timeoutMs: 300 })).rejects.toMatchObject({ reason: 'timeout' })
  })
})

describe('the private hatch cannot be opened in production', () => {
  it('SSRF_ALLOW_PRIVATE=1 is ignored when NODE_ENV=production', async () => {
    const prev = process.env.NODE_ENV
    process.env.SSRF_ALLOW_PRIVATE = '1'
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError)
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = prev
    }
  })
})
