/**
 * AWS Signature Version 4, by hand, for Cloudflare R2's S3 API. No SDK:
 * the crm-audit scripts run on 2 GB VPSs and need four calls (PUT, GET,
 * list, and nothing else), so a hundred lines of Node crypto beat a
 * multi-megabyte dependency. Pure — the clock and the payload hash are
 * passed in, so it is tested against AWS's published vectors.
 *
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

import crypto from 'crypto'

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
}

export interface SigV4Request {
  method: string
  host: string
  /** Already-encoded canonical path, e.g. "/bucket/audit/x.ndjson" (see encodeKeyPath). */
  path: string
  query?: Record<string, string>
  /** Extra headers to sign (lower-case names). host and x-amz-date are added. */
  headers?: Record<string, string>
  /** Hex SHA-256 of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash: string
  /** "YYYYMMDDTHHMMSSZ" */
  amzDate: string
}

export interface SigV4Result {
  /** Every header to send, Authorization included. */
  headers: Record<string, string>
  canonicalRequest: string
  stringToSign: string
  signature: string
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

/** RFC 3986 encoding as SigV4 wants it: only A–Z a–z 0–9 - _ . ~ stay. */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** "/bucket/a/b c.txt" → each segment encoded once, slashes kept. */
export function encodeKeyPath(bucket: string, key: string): string {
  return `/${uriEncode(bucket)}/${key.split('/').map(uriEncode).join('/')}`
}

export function amzDateOf(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function signRequest(req: SigV4Request, creds: SigV4Credentials): SigV4Result {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v
  headers.host = req.host
  headers['x-amz-date'] = req.amzDate

  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalQuery = Object.entries(req.query ?? {})
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalRequest = [req.method.toUpperCase(), req.path || '/', canonicalQuery, canonicalHeaders, signedHeaders, req.payloadHash].join('\n')
  const day = req.amzDate.slice(0, 8)
  const scope = `${day}/${creds.region}/${creds.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', req.amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, day)
  const kRegion = hmac(kDate, creds.region)
  const kService = hmac(kRegion, creds.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  }
}
