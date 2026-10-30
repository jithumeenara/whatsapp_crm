import { safeFetch } from '@/lib/net/safe-fetch'

/** Headers a step's own header list may not set: they would change where
 *  the request goes or how it is framed, not what it says. */
const RESERVED = new Set(['host', 'content-length', 'transfer-encoding', 'connection'])

/**
 * The "send webhook" automation step. The URL is whatever a member of the
 * workspace typed, so it goes through safeFetch rather than fetch: a step
 * pointed at 127.0.0.1, the VPS's private network or the cloud metadata
 * service is refused, and its error (which the automation's log shows)
 * says so instead of revealing what answered there.
 */
export async function postAutomationWebhook(
  url: string,
  headers: Record<string, string> | undefined,
  body: string,
): Promise<number> {
  const sent: Record<string, string> = { 'content-type': 'application/json' }
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (typeof v === 'string' && !RESERVED.has(k.toLowerCase())) sent[k] = v
  }
  const res = await safeFetch(url, { method: 'POST', headers: sent, body }, { timeoutMs: 15_000, maxBytes: 1024 * 1024 })
  // The answer is not used; drain it so the socket closes.
  await res.arrayBuffer().catch(() => undefined)
  return res.status
}
