import http from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import dns from 'node:dns'
import zlib from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertPublicUrl,
  isBlockedAddress,
  safeFetch,
  SafeFetchError,
  SsrfBlockedError,
} from './safe-fetch'

/**
 * DNS is never really asked anything here. `dns.lookup` is replaced with
 * a table, so a test can say "this name resolves to 127.0.0.1" and watch
 * what the client does with it — which is the whole of DNS rebinding.
 */
type Answer = Array<{ address: string; family: 4 | 6 }>
let table: Record<string, Answer | (() => Answer)> = {}
let lookups: string[] = []
const realLookup = dns.lookup.bind(dns)

function fakeLookup(
  hostname: string,
  options: unknown,
  callback?: (...args: unknown[]) => void,
) {
  const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void
  const opts = (typeof options === 'object' && options) || {}
  // The test servers' own listen() resolves its literal address; that
  // is not the client asking, and it gets the real answer.
  if (isIP(hostname)) return realLookup(hostname, opts as dns.LookupOptions, cb as never)
  lookups.push(hostname)
  const entry = table[hostname]
  const answer = typeof entry === 'function' ? entry() : entry
  if (!answer || answer.length === 0) {
    const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })
    process.nextTick(() => cb(err))
    return
  }
  if ((opts as { all?: boolean }).all) process.nextTick(() => cb(null, answer))
  else process.nextTick(() => cb(null, answer[0].address, answer[0].family))
}

beforeAll(() => {
  vi.spyOn(dns, 'lookup').mockImplementation(fakeLookup as unknown as typeof dns.lookup)
})
afterEach(() => {
  table = {}
  lookups = []
  vi.unstubAllEnvs()
})

// ── A local server standing in for "somewhere on the internet" ────────

interface Hit { url: string; method: string; headers: http.IncomingHttpHeaders; body: string }
function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  const hits: Hit[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      hits.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body })
      handler(req, res, body)
    })
  })
  return new Promise<{ server: http.Server; port: number; hits: Hit[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, hits }))
  })
}

let a: Awaited<ReturnType<typeof startServer>>
let b: Awaited<ReturnType<typeof startServer>>
beforeAll(async () => {
  a = await startServer((req, res, body) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/ok') return res.end('hello')
    if (u.pathname === '/echo') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization ?? null }))
    }
    if (u.pathname === '/redirect') {
      res.statusCode = Number(u.searchParams.get('code') ?? 302)
      res.setHeader('location', u.searchParams.get('to') ?? '/ok')
      return res.end()
    }
    if (u.pathname === '/loop') {
      res.statusCode = 302
      res.setHeader('location', '/loop')
      return res.end()
    }
    if (u.pathname === '/big') {
      res.setHeader('content-length', String(5000))
      return res.end('x'.repeat(5000))
    }
    if (u.pathname === '/big-chunked') {
      // No content-length: the cap has to be enforced while streaming.
      res.write('x'.repeat(3000))
      setTimeout(() => res.end('x'.repeat(3000)), 10)
      return
    }
    if (u.pathname === '/gzip-bomb') {
      res.setHeader('content-encoding', 'gzip')
      return res.end(zlib.gzipSync(Buffer.alloc(200_000)))
    }
    if (u.pathname === '/gzip') {
      res.setHeader('content-encoding', 'gzip')
      return res.end(zlib.gzipSync('compressed hello'))
    }
    if (u.pathname === '/slow') {
      setTimeout(() => res.end('late'), 2_000)
      return
    }
    res.statusCode = 404
    res.end()
  })
  b = await startServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }))
  })
})
afterAll(() => {
  a.server.close()
  b.server.close()
})

/** Loopback servers are only reachable through the test escape hatch. */
function allowLoopback() {
  vi.stubEnv('SSRF_ALLOW_PRIVATE', '1')
  vi.stubEnv('NODE_ENV', 'test')
}

// ── The address policy ───────────────────────────────────────────────

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '169.254.169.254', '169.254.0.1',
    '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.0.1', '192.0.2.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '::', '::1', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', 'fec0::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::127.0.0.1',
    '64:ff9b::127.0.0.1', '64:ff9b::a00:1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::1',
    '2002:7f00:1::', '2001::1',
    'not-an-ip', '',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    '93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255',
    '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::',
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })
})

// ── assertPublicUrl ──────────────────────────────────────────────────

describe('assertPublicUrl', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['gopher://example.com/', 'scheme'],
    ['ftp://example.com/', 'scheme'],
    ['data:text/plain,hi', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['http://user:pass@example.com/', 'credentials'],
    ['http://user@example.com/', 'credentials'],
    ['http://example.com:8080/', 'port'],
    ['https://example.com:22/', 'port'],
    ['not a url', 'invalid'],
  ])('refuses %s (%s)', async (url, reason) => {
    table['example.com'] = [{ address: '93.184.216.34', family: 4 }]
    const err = await assertPublicUrl(url).catch((e) => e)
    expect(err).toBeInstanceOf(SsrfBlockedError)
    expect(err.reason).toBe(reason)
  })

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/', // decimal
    'http://0177.0.0.1/', // octal
    'http://0x7f.1/', // hex, short form
    'http://0x7f000001/',
    'http://127.1/', // short form
    'http://0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:ffff:127.0.0.1]/',
    'http://[64:ff9b::127.0.0.1]/',
    'http://[fd00:ec2::254]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0xa9.0xfe.0xa9.0xfe/', // 169.254.169.254 in hex
    'http://10.1/', // 10.0.0.1
    'http://%31%32%37.0.0.1/', // percent-encoded 127
  ])('refuses the private address %s, whatever its spelling', async (url) => {
    const err = await assertPublicUrl(url).catch((e) => e)
    expect(err).toBeInstanceOf(SsrfBlockedError)
    expect(err.reason).toBe('address')
    // A literal address is judged as written; DNS is never asked.
    expect(lookups).toEqual([])
  })

  it('refuses a name that resolves to a private address', async () => {
    table['internal.example'] = [{ address: '10.0.0.5', family: 4 }]
    await expect(assertPublicUrl('https://internal.example/')).rejects.toMatchObject({ reason: 'address' })
  })

  it('refuses a name with one private address among public ones', async () => {
    table['mixed.example'] = [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    await expect(assertPublicUrl('https://mixed.example/')).rejects.toMatchObject({ reason: 'address' })
  })

  it('refuses localhost and names that do not resolve', async () => {
    table['localhost'] = [{ address: '127.0.0.1', family: 4 }]
    await expect(assertPublicUrl('http://localhost/')).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(assertPublicUrl('http://nowhere.invalid/')).rejects.toMatchObject({ reason: 'dns' })
  })

  it('accepts a public name and returns the parsed URL', async () => {
    table['example.com'] = [{ address: '93.184.216.34', family: 4 }]
    const url = await assertPublicUrl('https://example.com/a?b=1')
    expect(url.href).toBe('https://example.com/a?b=1')
  })

  it('accepts an allowed extra port only when asked', async () => {
    table['example.com'] = [{ address: '93.184.216.34', family: 4 }]
    await expect(assertPublicUrl('https://example.com:8443/', { allowedPorts: [443, 8443] })).resolves.toBeInstanceOf(URL)
  })

  it('takes the escape hatch only from the server environment, and never in production', async () => {
    vi.stubEnv('SSRF_ALLOW_PRIVATE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError)
    vi.stubEnv('NODE_ENV', 'development')
    await expect(assertPublicUrl('http://127.0.0.1/')).resolves.toBeInstanceOf(URL)
    // Cloud metadata stays closed even then.
    await expect(assertPublicUrl('http://169.254.169.254/')).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(assertPublicUrl('http://[fd00:ec2::254]/')).rejects.toBeInstanceOf(SsrfBlockedError)
  })
})

// ── safeFetch ────────────────────────────────────────────────────────

describe('safeFetch: what it refuses before connecting', () => {
  it('refuses a literal loopback address without connecting', async () => {
    const before = a.hits.length
    const err = await safeFetch(`http://127.0.0.1:${a.port}/ok`, undefined, { allowedPorts: [a.port] }).catch((e) => e)
    expect(err).toBeInstanceOf(SsrfBlockedError)
    expect(a.hits.length).toBe(before)
  })

  it('checks the address it connects to — DNS rebinding cannot slip through', async () => {
    // The name is public on a first look and private on the second. The
    // client resolves exactly once, at connection time, and judges that.
    let calls = 0
    table['rebind.example'] = () =>
      calls++ === 0 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]
    const before = a.hits.length
    const err = await safeFetch(`http://rebind.example:${a.port}/ok`, undefined, { allowedPorts: [a.port] }).catch((e) => e)
    expect(err).toBeInstanceOf(SsrfBlockedError)
    expect(a.hits.length).toBe(before)
    expect(lookups.filter((h) => h === 'rebind.example').length).toBe(1)
  })

  it('refuses a name whose answers include a private address', async () => {
    table['mixed.example'] = [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    const before = a.hits.length
    await expect(
      safeFetch(`http://mixed.example:${a.port}/ok`, undefined, { allowedPorts: [a.port] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(a.hits.length).toBe(before)
  })

  it('refuses a port that was not allowed', async () => {
    allowLoopback()
    await expect(safeFetch(`http://127.0.0.1:${a.port}/ok`)).rejects.toMatchObject({ reason: 'port' })
  })
})

describe('safeFetch: through the test escape hatch', () => {
  it('fetches, and reports the final url', async () => {
    allowLoopback()
    const res = await safeFetch(`http://127.0.0.1:${a.port}/ok`, undefined, { allowedPorts: [a.port] })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    expect(res.url).toBe(`http://127.0.0.1:${a.port}/ok`)
  })

  it('connects to exactly the address its own lookup judged', async () => {
    // The name goes through the guarded lookup (escape hatch open for
    // loopback), and the socket reaches the server at that address.
    allowLoopback()
    table['svc.example'] = [{ address: '127.0.0.1', family: 4 }]
    const res = await safeFetch(`http://svc.example:${a.port}/ok`, undefined, { allowedPorts: [a.port] })
    expect(await res.text()).toBe('hello')
    expect(lookups).toEqual(['svc.example'])
  })

  it('posts a body', async () => {
    allowLoopback()
    const res = await safeFetch(
      `http://127.0.0.1:${a.port}/echo`,
      { method: 'POST', body: JSON.stringify({ q: 1 }), headers: { 'content-type': 'application/json' } },
      { allowedPorts: [a.port] },
    )
    expect(await res.json()).toMatchObject({ method: 'POST', body: '{"q":1}' })
  })

  it('decompresses gzip', async () => {
    allowLoopback()
    const res = await safeFetch(`http://127.0.0.1:${a.port}/gzip`, undefined, { allowedPorts: [a.port] })
    expect(await res.text()).toBe('compressed hello')
  })

  it('follows a redirect, and re-checks where it goes', async () => {
    allowLoopback()
    const ok = await safeFetch(`http://127.0.0.1:${a.port}/redirect?to=/ok`, undefined, { allowedPorts: [a.port] })
    expect(await ok.text()).toBe('hello')
    expect(ok.redirected).toBe(true)

    // Cloud metadata is closed even through the escape hatch.
    const meta = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?to=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`,
      undefined,
      { allowedPorts: [a.port, 80] },
    ).catch((e) => e)
    expect(meta).toBeInstanceOf(SsrfBlockedError)

    const file = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?to=${encodeURIComponent('file:///etc/passwd')}`,
      undefined,
      { allowedPorts: [a.port] },
    ).catch((e) => e)
    expect(file).toMatchObject({ reason: 'scheme' })
  })

  it('re-checks a redirect to a name, at connection time', async () => {
    // Escape hatch off for the hop being judged: the redirect goes to a
    // name that resolves to loopback.
    allowLoopback()
    table['evil.example'] = [{ address: '169.254.169.254', family: 4 }]
    const err = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?to=${encodeURIComponent(`http://evil.example:${a.port}/ok`)}`,
      undefined,
      { allowedPorts: [a.port] },
    ).catch((e) => e)
    expect(err).toBeInstanceOf(SsrfBlockedError)
  })

  it('stops after the redirect limit', async () => {
    allowLoopback()
    await expect(
      safeFetch(`http://127.0.0.1:${a.port}/loop`, undefined, { allowedPorts: [a.port], maxRedirects: 2 }),
    ).rejects.toMatchObject({ reason: 'redirects' })
  })

  it('hands back the redirect itself when asked to', async () => {
    allowLoopback()
    const res = await safeFetch(`http://127.0.0.1:${a.port}/redirect?to=/ok`, { redirect: 'manual' }, { allowedPorts: [a.port] })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/ok')
  })

  it('drops credentials on a redirect to another origin, keeps them on the same one', async () => {
    allowLoopback()
    const ports = [a.port, b.port]
    const cross = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?to=${encodeURIComponent(`http://127.0.0.1:${b.port}/`)}`,
      { headers: { authorization: 'Bearer secret', cookie: 'sid=1' } },
      { allowedPorts: ports },
    )
    expect(await cross.json()).toEqual({ auth: null, cookie: null })

    const same = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?to=/echo`,
      { headers: { authorization: 'Bearer secret' } },
      { allowedPorts: ports },
    )
    expect(await same.json()).toMatchObject({ auth: 'Bearer secret' })
  })

  it('turns a POST into a GET on 303, and keeps it on 307', async () => {
    allowLoopback()
    const see = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?code=303&to=/echo`,
      { method: 'POST', body: 'x' },
      { allowedPorts: [a.port] },
    )
    expect(await see.json()).toMatchObject({ method: 'GET', body: '' })
    const keep = await safeFetch(
      `http://127.0.0.1:${a.port}/redirect?code=307&to=/echo`,
      { method: 'POST', body: 'x' },
      { allowedPorts: [a.port] },
    )
    expect(await keep.json()).toMatchObject({ method: 'POST', body: 'x' })
  })

  it('caps the response size, declared or streamed', async () => {
    allowLoopback()
    await expect(
      safeFetch(`http://127.0.0.1:${a.port}/big`, undefined, { allowedPorts: [a.port], maxBytes: 1000 }),
    ).rejects.toMatchObject({ reason: 'size' })

    const streamed = await safeFetch(`http://127.0.0.1:${a.port}/big-chunked`, undefined, {
      allowedPorts: [a.port],
      maxBytes: 4000,
    })
    const err = await streamed.text().catch((e) => e)
    expect(err).toBeInstanceOf(Error)

    // Counted after decompression: a small gzip that inflates past the cap.
    const bomb = await safeFetch(`http://127.0.0.1:${a.port}/gzip-bomb`, undefined, {
      allowedPorts: [a.port],
      maxBytes: 10_000,
    })
    await expect(bomb.arrayBuffer()).rejects.toBeInstanceOf(Error)
  })

  it('times out', async () => {
    allowLoopback()
    const err = await safeFetch(`http://127.0.0.1:${a.port}/slow`, undefined, {
      allowedPorts: [a.port],
      timeoutMs: 100,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SafeFetchError)
    expect(err.reason).toBe('timeout')
  })

  it('honours the caller’s own abort signal', async () => {
    allowLoopback()
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 50)
    await expect(
      safeFetch(`http://127.0.0.1:${a.port}/slow`, { signal: ctrl.signal }, { allowedPorts: [a.port] }),
    ).rejects.toBeInstanceOf(Error)
  })
})
