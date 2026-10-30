import { safeFetch } from '@/lib/net/safe-fetch'
import { portsFor } from '@/lib/ai/providers/ssrf-guard'

/**
 * The request a flow's "HTTP request" step makes.
 *
 * The URL is whatever the flow's author typed, with contact fields
 * filled in, and the reply is saved into a flow variable a later step
 * can send to WhatsApp. Made with a plain fetch, that was a way for any
 * account admin to read the server's own network — the cloud metadata
 * service, anything on loopback — one message at a time. So:
 *
 *   - every hop, redirects included, must connect to a public address
 *     (the central safeFetch); the URL's own port is allowed, since a
 *     webhook receiver on :8080 is ordinary and the address rule still
 *     applies;
 *   - the step gives up after REQUEST_TIMEOUT_MS instead of holding the
 *     customer's flow open on a server that never answers;
 *   - the reply is read up to MAX_RESPONSE_BYTES, because it is going
 *     into a database column and maybe a chat message, not a file.
 */

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export interface HttpNodeRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export async function runHttpNodeRequest(req: HttpNodeRequest): Promise<{ status: number; ok: boolean; text: string }> {
  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json', ...req.headers },
  }
  if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body
  const resp = await safeFetch(req.url, init, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    allowedPorts: portsFor(req.url),
  })
  return { status: resp.status, ok: resp.ok, text: await resp.text() }
}
