/**
 * The three Cloudflare R2 calls the off-server audit copy needs, over the
 * S3 API with hand-made SigV4 (sigv4.ts). Path-style URLs:
 *   https://<account-id>.r2.cloudflarestorage.com/<bucket>/<key>
 *
 * The server's token can write objects only; it never deletes and every
 * PUT carries If-None-Match: * so an existing object is never replaced
 * (and Bucket Lock refuses it anyway). The read-only token is used by the
 * daily check and the GitHub job.
 */

import { amzDateOf, encodeKeyPath, sha256Hex, signRequest } from './sigv4'

export interface R2Config {
  /** https://<account-id>.r2.cloudflarestorage.com */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** R2 uses "auto". */
  region?: string
}

function target(cfg: R2Config, key: string | null) {
  const u = new URL(cfg.endpoint)
  if (u.protocol !== 'https:') throw new Error('R2 endpoint must be https')
  return { host: u.host, origin: `${u.protocol}//${u.host}`, path: key === null ? `/${encodeURIComponent(cfg.bucket)}` : encodeKeyPath(cfg.bucket, key) }
}

async function send(
  cfg: R2Config,
  method: 'GET' | 'PUT',
  key: string | null,
  opts: { body?: Buffer; query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Response> {
  const t = target(cfg, key)
  const payloadHash = sha256Hex(opts.body ?? Buffer.alloc(0))
  const signed = signRequest(
    {
      method,
      host: t.host,
      path: t.path,
      query: opts.query,
      headers: { ...(opts.headers ?? {}), 'x-amz-content-sha256': payloadHash },
      payloadHash,
      amzDate: amzDateOf(new Date()),
    },
    { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region || 'auto', service: 's3' },
  )
  // fetch sets Host itself from the URL (the same value that was signed).
  const { host: _host, ...headers } = signed.headers
  void _host
  const qs = new URLSearchParams(opts.query ?? {}).toString()
  return fetch(`${t.origin}${t.path}${qs ? `?${qs}` : ''}`, {
    method,
    headers,
    body: opts.body ? new Uint8Array(opts.body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
}

async function failure(res: Response, what: string): Promise<Error> {
  // R2 error bodies are small XML documents; only the <Code> is kept.
  const text = await res.text().catch(() => '')
  const code = /<Code>([^<]{1,80})<\/Code>/.exec(text)?.[1] ?? ''
  return new Error(`${what}: HTTP ${res.status}${code ? ` ${code}` : ''}`)
}

/** Writes an object only if the name is free. "exists" means it was already there. */
export async function putObjectOnce(cfg: R2Config, key: string, body: Buffer, contentType: string): Promise<'created' | 'exists'> {
  const res = await send(cfg, 'PUT', key, { body, headers: { 'content-type': contentType, 'if-none-match': '*' } })
  if (res.status === 200 || res.status === 201) {
    await res.arrayBuffer().catch(() => null)
    return 'created'
  }
  if (res.status === 412) {
    await res.arrayBuffer().catch(() => null)
    return 'exists'
  }
  throw await failure(res, `R2 PUT ${key}`)
}

export async function getObject(cfg: R2Config, key: string): Promise<Buffer | null> {
  const res = await send(cfg, 'GET', key)
  if (res.status === 404) return null
  if (!res.ok) throw await failure(res, `R2 GET ${key}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Every key under a prefix (ListObjectsV2, all pages). */
export async function listKeys(cfg: R2Config, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | null = null
  for (let page = 0; page < 10_000; page++) {
    const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' }
    if (token) query['continuation-token'] = token
    const res = await send(cfg, 'GET', null, { query })
    if (!res.ok) throw await failure(res, `R2 list ${prefix}`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unescapeXml(m[1]))
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    token = truncated ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null
    if (!token) break
    token = unescapeXml(token)
  }
  return keys
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
