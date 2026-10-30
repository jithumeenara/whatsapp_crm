/**
 * Fetching a URL somebody else chose.
 *
 * ── Why plain fetch() is not enough ─────────────────────────────────
 *
 * A tenant pastes a webhook URL, a website to train the bot on, a logo
 * link, an integration endpoint. Handed straight to fetch(), every one
 * of those is a request this server makes on the caller's behalf from
 * inside the network — to 127.0.0.1:5432, to the cloud metadata service
 * at 169.254.169.254 and the credentials it hands out, to whatever else
 * listens on the VPS's private side. That is server-side request
 * forgery, and checking the URL's text first does not stop it:
 *
 *   - addresses have many spellings (2130706433, 0177.0.0.1, 0x7f.1,
 *     127.1, [::ffff:127.0.0.1]) — the URL parser normalises them, so
 *     the check here judges what the parser produced, never the text;
 *   - a name can resolve to a public address when checked and a private
 *     one a moment later when connected (DNS rebinding) — so the address
 *     is judged inside the connection's own lookup, once, and the socket
 *     goes to exactly the address that was judged;
 *   - a public URL can redirect to a private one — so redirects are
 *     followed here, by hand, each hop through the same checks.
 *
 * ── Why node:http rather than undici ────────────────────────────────
 *
 * undici's Agent is the other way to own the lookup, but undici is not a
 * dependency of this app (it is only somebody else's transitive one),
 * and importing a package the lockfile may drop is a build waiting to
 * break. node:http's `lookup` option gives the same guarantee: it is the
 * only resolution the connection makes.
 *
 * ── What it still honours ───────────────────────────────────────────
 *
 * The development send guard (src/lib/dev/send-guard.ts) patches global
 * fetch; this client does not go through fetch, so it asks the guard
 * itself on every hop. A laptop still sends nothing to real people.
 *
 * Imported by code that server.ts runs directly, so relative imports
 * only — no "@/..." alias.
 */

import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable, Transform } from 'node:stream'
import zlib from 'node:zlib'
import { blockedSend } from '../dev/send-guard'

// ── Errors ──────────────────────────────────────────────────────────

export type SafeFetchReason =
  | 'invalid' // not a URL
  | 'scheme' // not http/https
  | 'credentials' // user:pass@ in the URL
  | 'port' // a port nobody allowed
  | 'address' // resolves to (or is) a private / reserved address
  | 'dns' // the name does not resolve
  | 'redirects' // too many redirects, or a redirect when told not to
  | 'size' // the response was larger than allowed
  | 'timeout'

/** Anything this client refuses or gives up on. `reason` says which. */
export class SafeFetchError extends Error {
  readonly reason: SafeFetchReason
  constructor(reason: SafeFetchReason, message: string) {
    super(message)
    this.name = 'SafeFetchError'
    this.reason = reason
  }
}

/**
 * The URL, or where it led, is somewhere this server must not go.
 * The message is safe to show a user; it never contains the address a
 * name resolved to, which would make this a free internal port scanner.
 */
export class SsrfBlockedError extends SafeFetchError {
  constructor(reason: SafeFetchReason, message = 'That address cannot be reached from here.') {
    super(reason, message)
    this.name = 'SsrfBlockedError'
  }
}

// ── Options ─────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  /** Ports a URL may name. Default 80 and 443. */
  allowedPorts?: readonly number[]
  /** Redirects followed before giving up. Default 3. */
  maxRedirects?: number
  /** For the whole exchange, body included. Default 10 s. */
  timeoutMs?: number
  /** Largest response body, counted after decompression. Default 10 MB. */
  maxBytes?: number
}

const DEFAULT_PORTS = [80, 443] as const
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/**
 * The escape hatch for a laptop whose test services run on localhost.
 * Read from the server's own environment, never from a request, and
 * ignored outright in production. Even open, it lets through private
 * and loopback ranges only — never link-local / cloud metadata.
 */
function privateAllowed(): boolean {
  return process.env.SSRF_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production'
}

// ── The address policy ──────────────────────────────────────────────

type AddressClass = 'public' | 'private' | 'metadata'

function inV4(b: number[], base: [number, number, number, number], bits: number): boolean {
  const ip = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  const net = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (net & mask)
}

function classifyV4(b: number[]): AddressClass {
  // Link-local, which is where every major cloud keeps its metadata
  // service, and Alibaba's, which is not.
  if (inV4(b, [169, 254, 0, 0], 16)) return 'metadata'
  if (inV4(b, [100, 100, 100, 200], 32)) return 'metadata'
  const reserved: Array<[[number, number, number, number], number]> = [
    [[0, 0, 0, 0], 8], // "this network" — 0.0.0.0 reaches localhost
    [[10, 0, 0, 0], 8],
    [[100, 64, 0, 0], 10], // carrier-grade NAT
    [[127, 0, 0, 0], 8],
    [[172, 16, 0, 0], 12],
    [[192, 0, 0, 0], 24], // IETF protocol assignments
    [[192, 0, 2, 0], 24], // documentation
    [[192, 88, 99, 0], 24], // 6to4 relay anycast
    [[192, 168, 0, 0], 16],
    [[198, 18, 0, 0], 15], // benchmarking
    [[198, 51, 100, 0], 24], // documentation
    [[203, 0, 113, 0], 24], // documentation
    [[224, 0, 0, 0], 4], // multicast
    [[240, 0, 0, 0], 4], // reserved, and 255.255.255.255
  ]
  return reserved.some(([base, bits]) => inV4(b, base, bits)) ? 'private' : 'public'
}

function parseV4(ip: string): number[] | null {
  if (!net.isIPv4(ip)) return null
  return ip.split('.').map(Number)
}

/** 16 bytes, or null. Accepts "::", embedded IPv4 and a zone suffix. */
function parseV6(input: string): number[] | null {
  const ip = input.replace(/%.*$/, '')
  if (!net.isIPv6(ip)) return null
  let head = ip
  const tail: number[] = []
  // An embedded dotted IPv4 in the last 32 bits.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(head)
  if (v4) {
    const b = parseV4(v4[1])
    if (!b) return null
    tail.push((b[0] << 8) | b[1], (b[2] << 8) | b[3])
    head = head.slice(0, -v4[1].length)
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1)
  }
  const [left, right] = head.includes('::') ? head.split('::') : [head, null]
  const words = (s: string) => (s ? s.split(':').filter((w) => w !== '').map((w) => parseInt(w, 16)) : [])
  const l = words(left)
  const r = right === null ? [] : words(right)
  const fill = 8 - tail.length - l.length - r.length
  if (right === null && fill !== 0) return null
  if (fill < 0) return null
  const all = [...l, ...new Array(right === null ? 0 : fill).fill(0), ...r, ...tail]
  if (all.length !== 8) return null
  return all.flatMap((w) => [(w >> 8) & 0xff, w & 0xff])
}

function classifyV6(b: number[]): AddressClass {
  const w = Array.from({ length: 8 }, (_, i) => (b[i * 2] << 8) | b[i * 2 + 1])
  const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0)

  // ::, ::1, and the deprecated IPv4-compatible ::a.b.c.d.
  if (zero(0, 6)) return 'private'
  // IPv4-mapped ::ffff:a.b.c.d — judged as the IPv4 address it is.
  if (zero(0, 5) && w[5] === 0xffff) return classifyV4(b.slice(12))
  // NAT64, well-known prefix: the IPv4 address it will reach.
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) return classifyV4(b.slice(12))
  // NAT64, local-use prefix: translated somewhere inside.
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return 'private'
  // 6to4: the IPv4 address in bits 16–47.
  if (w[0] === 0x2002) return classifyV4(b.slice(2, 6))
  // Teredo, ORCHID, documentation.
  if (w[0] === 0x2001 && (w[1] === 0 || (w[1] & 0xfff0) === 0x10 || w[1] === 0xdb8)) return 'private'
  // AWS's IPv6 metadata endpoint lives in fd00:ec2::/32.
  if (w[0] === 0xfd00 && w[1] === 0x0ec2) return 'metadata'
  if ((w[0] & 0xffc0) === 0xfe80) return 'metadata' // link-local
  if ((w[0] & 0xfe00) === 0xfc00) return 'private' // unique local
  if ((w[0] & 0xffc0) === 0xfec0) return 'private' // site-local (deprecated)
  if (b[0] === 0xff) return 'private' // multicast
  // Everything routable on the internet is in 2000::/3.
  if ((b[0] & 0xe0) !== 0x20) return 'private'
  return 'public'
}

function classify(ip: string): AddressClass {
  const v4 = parseV4(ip)
  if (v4) return classifyV4(v4)
  const v6 = parseV6(ip)
  if (v6) return classifyV6(v6)
  // Not an address at all: nothing to connect to, so nothing allowed.
  return 'private'
}

/**
 * True when this server must not connect to `ip`. Anything that is not a
 * well-formed IPv4 or IPv6 address counts as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  return classify(ip) !== 'public'
}

/** The policy as applied right now, escape hatch included. */
function refused(ip: string): boolean {
  const c = classify(ip)
  if (c === 'public') return false
  if (c === 'private' && privateAllowed()) return false
  return true
}

// ── URL checks ──────────────────────────────────────────────────────

interface Target {
  url: URL
  /** Bare hostname for node:http (no IPv6 brackets). */
  host: string
  port: number
  /** True when the host is a literal address, judged already. */
  literal: boolean
}

/** Everything that can be said about a URL without DNS. */
function checkUrl(input: string | URL, allowedPorts: readonly number[]): Target {
  let url: URL
  try {
    url = new URL(String(input))
  } catch {
    throw new SsrfBlockedError('invalid', 'That is not a valid web address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError('scheme', 'Only http and https addresses can be used.')
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('credentials', 'Addresses with a username or password in them cannot be used.')
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (!allowedPorts.includes(port)) {
    throw new SsrfBlockedError('port', `Port ${port} cannot be used.`)
  }

  // WHATWG URL has already turned every IPv4 spelling (decimal, octal,
  // hex, short forms, percent-encoding) into dotted form, and IPv6 into
  // its compressed form in brackets. What is judged is that, not the
  // text the caller wrote.
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const literal = net.isIP(host) !== 0
  if (literal) {
    if (refused(host)) throw new SsrfBlockedError('address')
  } else {
    const bare = host.replace(/\.$/, '').toLowerCase()
    if ((bare === 'localhost' || bare.endsWith('.localhost')) && !privateAllowed()) {
      throw new SsrfBlockedError('address')
    }
  }
  return { url, host, port, literal }
}

type LookupAnswer = Array<{ address: string; family: number }>

function resolveAll(hostname: string): Promise<LookupAnswer> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err)
      else resolve(addresses as LookupAnswer)
    })
  })
}

/** Every address the name has, or the reason it may not be used. */
async function resolvePublic(hostname: string): Promise<LookupAnswer> {
  let answer: LookupAnswer
  try {
    answer = await resolveAll(hostname)
  } catch {
    throw new SsrfBlockedError('dns', 'That address could not be found.')
  }
  if (answer.length === 0) throw new SsrfBlockedError('dns', 'That address could not be found.')
  // One private answer refuses the lot: which of them the connection
  // would pick is not ours to know.
  if (answer.some((a) => refused(a.address))) throw new SsrfBlockedError('address')
  return answer
}

/**
 * Check a URL as somebody's input, before saving it.
 *
 * Resolves the name now. That makes it a good "is this a sensible URL"
 * check for a settings form — and NOT a guarantee for a later request,
 * because the name can point somewhere else by then. Fetch with
 * {@link safeFetch}, which checks again at connection time.
 */
export async function assertPublicUrl(
  input: string | URL,
  opts: Pick<SafeFetchOptions, 'allowedPorts'> = {},
): Promise<URL> {
  const target = checkUrl(input, opts.allowedPorts ?? DEFAULT_PORTS)
  if (!target.literal) await resolvePublic(target.host)
  return target.url
}

/**
 * The connection's one and only DNS lookup. Node calls this from
 * net.connect; whatever it returns is the address the socket opens,
 * so what is judged here is exactly what is reached.
 */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  resolvePublic(hostname).then(
    (answer) => {
      const wanted = options?.family === 4 || options?.family === 6 ? answer.filter((a) => a.family === options.family) : answer
      if (wanted.length === 0) {
        callback(Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }), '', 0)
      } else if (options?.all) {
        callback(null, wanted as dns.LookupAddress[])
      } else {
        callback(null, wanted[0].address, wanted[0].family)
      }
    },
    (err: Error) => callback(err as NodeJS.ErrnoException, '', 0),
  )
}

// Own agents, no keep-alive: a pooled socket opened by some other code
// to the same host:port would otherwise be reused without ever passing
// through the lookup above.
const httpAgent = new http.Agent({ keepAlive: false })
const httpsAgent = new https.Agent({ keepAlive: false })

// ── The request ─────────────────────────────────────────────────────

export type SafeFetchInit = Omit<RequestInit, 'window'>

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const NULL_BODY = new Set([101, 204, 205, 304])

/** Headers that identify the caller, dropped when a redirect leaves the origin. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization']

function sizeCap(maxBytes: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length
      if (seen > maxBytes) done(new SafeFetchError('size', 'The response was too large.'))
      else done(null, chunk)
    },
  })
}

function decoder(encoding: string | undefined): Transform | null {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip()
    case 'deflate':
      return zlib.createInflate()
    case 'br':
      return zlib.createBrotliDecompress()
    default:
      return null
  }
}

interface Hop {
  target: Target
  method: string
  headers: Headers
  body: Buffer | undefined
  signal: AbortSignal
  maxBytes: number
  abortReason: () => Error
}

function send(hop: Hop): Promise<{ status: number; statusText: string; headers: Headers; stream: Readable | null; raw: http.IncomingMessage }> {
  const { target, method, headers, body, signal } = hop
  const isHttps = target.url.protocol === 'https:'
  const outgoing: Record<string, string> = {}
  headers.forEach((value, key) => (outgoing[key] = value))
  if (body) outgoing['content-length'] = String(body.length)

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request({
      protocol: target.url.protocol,
      hostname: target.host,
      port: target.port,
      path: target.url.pathname + target.url.search,
      method,
      headers: outgoing,
      agent: isHttps ? httpsAgent : httpAgent,
      lookup: guardedLookup as unknown as typeof dns.lookup,
      signal,
    })
    req.on('error', (err) => reject(signal.aborted ? hop.abortReason() : err))
    req.on('response', (res) => {
      const status = res.statusCode ?? 0
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue
        for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(key, v)
      }

      const declared = Number(res.headers['content-length'])
      if (Number.isFinite(declared) && declared > hop.maxBytes) {
        res.destroy()
        reject(new SafeFetchError('size', 'The response was too large.'))
        return
      }

      if (NULL_BODY.has(status) || method === 'HEAD') {
        res.resume()
        resolve({ status, statusText: res.statusMessage ?? '', headers: responseHeaders, stream: null, raw: res })
        return
      }

      let stream: Readable = res
      const decode = decoder(res.headers['content-encoding'])
      if (decode) {
        stream = stream.pipe(decode)
        res.on('error', (err) => decode.destroy(err))
        responseHeaders.delete('content-encoding')
        responseHeaders.delete('content-length')
      }
      const cap = sizeCap(hop.maxBytes)
      const source = stream
      stream = stream.pipe(cap)
      source.on('error', (err) => cap.destroy(signal.aborted ? hop.abortReason() : err))
      signal.addEventListener('abort', () => cap.destroy(hop.abortReason()), { once: true })
      resolve({ status, statusText: res.statusMessage ?? '', headers: responseHeaders, stream, raw: res })
    })
    if (body) req.end(body)
    else req.end()
  })
}

/**
 * fetch(), for a URL a user or a customer supplied.
 *
 * Takes a string or URL (not a Request). `init` is fetch's own, with
 * `redirect` honoured: 'follow' (default) follows up to `maxRedirects`
 * hops, each re-checked; 'manual' returns the 3xx as it came; 'error'
 * throws on one. Throws {@link SsrfBlockedError} for a refused address,
 * scheme, port or credential-bearing URL, and {@link SafeFetchError} for
 * a timeout, too many redirects or an oversized body (the size error
 * can also surface while reading the body).
 */
export async function safeFetch(
  input: string | URL,
  init: SafeFetchInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const allowedPorts = opts.allowedPorts ?? DEFAULT_PORTS
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const abortReason = () =>
    timeout.aborted && !init.signal?.aborted
      ? new SafeFetchError('timeout', 'The other server took too long to answer.')
      : Object.assign(new Error('The request was aborted.'), { name: 'AbortError' })

  let method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  let body: Buffer | undefined
  if (init.body != null) {
    // Let the platform turn whatever fetch accepts (string, bytes,
    // URLSearchParams, FormData, Blob) into bytes and a content type,
    // exactly as fetch would.
    const normalised = new Request('http://body.invalid/', {
      method,
      body: init.body,
      headers,
      duplex: 'half',
    } as RequestInit)
    body = Buffer.from(await normalised.arrayBuffer())
    const type = normalised.headers.get('content-type')
    if (type && !headers.has('content-type')) headers.set('content-type', type)
  }
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br')
  if (!headers.has('user-agent')) headers.set('user-agent', 'node')

  let current = String(input)
  for (let hop = 0; ; hop++) {
    if (signal.aborted) throw abortReason()
    const target = checkUrl(current, allowedPorts)

    // The send guard patches global fetch, which this does not use.
    const stopped = blockedSend(target.url.href, method, body?.toString('utf8'), process.env)
    if (stopped) {
      console.warn(`[DEV] ${stopped.name} NOT sent (safeFetch, protected environment)`)
      return stopped.reply()
    }

    const res = await send({ target, method, headers, body, signal, maxBytes, abortReason })
    const location = res.headers.get('location')

    if (REDIRECTS.has(res.status) && location && init.redirect !== 'manual') {
      res.raw.resume()
      res.stream?.resume()
      if (init.redirect === 'error') throw new SafeFetchError('redirects', 'The address redirected.')
      if (hop >= maxRedirects) throw new SafeFetchError('redirects', 'The address redirected too many times.')

      let next: URL
      try {
        next = new URL(location, target.url)
      } catch {
        throw new SsrfBlockedError('invalid', 'The address redirected somewhere invalid.')
      }
      // Same rules as fetch: 303, and a POST answered with 301/302,
      // continue as a GET without the body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        if (method !== 'HEAD') method = 'GET'
        body = undefined
        headers.delete('content-type')
        headers.delete('content-length')
      }
      if (next.origin !== target.url.origin) {
        for (const h of CREDENTIAL_HEADERS) headers.delete(h)
      }
      current = next.href
      continue
    }

    const response = new Response(res.stream ? (Readable.toWeb(res.stream) as ReadableStream) : null, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
    // Response's constructor cannot set these; callers read them.
    Object.defineProperty(response, 'url', { value: target.url.href })
    Object.defineProperty(response, 'redirected', { value: hop > 0 })
    return response
  }
}
