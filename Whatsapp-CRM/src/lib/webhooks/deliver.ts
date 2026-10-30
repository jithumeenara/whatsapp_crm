import { createHmac, randomBytes } from 'crypto'
import { assertPublicUrl, isBlockedAddress, safeFetch, SafeFetchError, SsrfBlockedError } from '@/lib/net/safe-fetch'
import { prisma } from '@/lib/db'
import { openStoredSecret } from '@/lib/whatsapp/encryption'

export type WebhookEvent = 'record.created' | 'record.updated' | 'record.deleted'
export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'record.created',
  'record.updated',
  'record.deleted',
]

export interface WebhookPayload {
  event: WebhookEvent
  table_id: string
  table_name: string
  record: {
    id: string
    data: Record<string, unknown>
    created_at: string
    updated_at: string
  }
  /** Unix milliseconds. Receivers should reject if |now - timestamp| > 300 000 ms. */
  timestamp: number
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

// ── SSRF protection ──────────────────────────────────────────────────────────
// The address rules are the central ones (src/lib/net/safe-fetch.ts): every
// IPv4 spelling, IPv4-mapped IPv6, ULA/link-local, CGNAT, metadata, …

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.', '0.0.0.0', '[::]', '[::1]'])

/**
 * Validate and normalise a webhook URL — the cheap, synchronous part:
 * https only, no credentials, and no literal internal address.
 * Throws a user-visible Error if the URL is unsafe or invalid.
 */
export function validateWebhookUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL format.')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not contain a user name or password.')
  }
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.localhost.')) {
    throw new Error('Webhook URL must not point to localhost.')
  }
  // WHATWG URL has already turned 2130706433 / 0x7f.1 / … into dotted form.
  const literal = host.startsWith('[') ? host.slice(1, -1) : /^[\d.]+$/.test(host) ? host : null
  if (literal && isBlockedAddress(literal)) {
    throw new Error('Webhook URL must not point to a private or reserved IP address.')
  }
  return parsed.toString()
}

/**
 * validateWebhookUrl plus a DNS check: a public-looking name that resolves
 * to an internal address is refused when saved. Delivery checks again at
 * connection time (safeFetch), since a name can change after it is saved.
 * `resolve` is for tests.
 */
export async function checkWebhookUrl(
  rawUrl: string,
  opts: { resolve?: (host: string) => Promise<string[]> } = {},
): Promise<string> {
  const url = validateWebhookUrl(rawUrl)
  try {
    if (opts.resolve) {
      const host = new URL(url).hostname
      const addresses = await opts.resolve(host)
      if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a))) throw new SsrfBlockedError('address')
    } else {
      await assertPublicUrl(url)
    }
  } catch (err) {
    if (err instanceof SafeFetchError) {
      throw new Error(
        err.reason === 'dns'
          ? 'Webhook URL’s host name could not be found.'
          : 'Webhook URL must not point to a private or reserved address.',
      )
    }
    throw err
  }
  return url
}

// ── Signing ──────────────────────────────────────────────────────────────────

export function signPayload(secret: string, payloadJson: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payloadJson, 'utf8').digest('hex')
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: find matching active webhooks and deliver the event.
 * Does NOT await — call after the DB write has succeeded and the HTTP
 * response is ready to be sent.
 */
export function dispatchWebhooks(
  accountId: string,
  event: WebhookEvent,
  tableId: string,
  record: WebhookPayload['record'],
  tableName: string,
): void {
  void (async () => {
    try {
      const hooks = await prisma.webhook.findMany({
        where: {
          account_id: accountId,
          is_active: true,
          events: { has: event },
          OR: [{ table_id: null }, { table_id: tableId }],
        },
        select: { id: true, url: true, signing_secret: true },
      })
      if (hooks.length === 0) return

      const payload: WebhookPayload = {
        event,
        table_id: tableId,
        table_name: tableName,
        record,
        timestamp: Date.now(),
      }
      const payloadJson = JSON.stringify(payload)

      await Promise.allSettled(
        hooks.map((h) => deliverOne(h.id, h.url, h.signing_secret, payloadJson, event)),
      )
    } catch (err) {
      console.error('[webhook-dispatch]', err)
    }
  })()
}

// ── Single-webhook delivery with retries ─────────────────────────────────────

const MAX_FAILURES = 10
const RETRY_DELAYS_MS = [0, 1_000, 4_000] // attempt 0 = immediate, 1 = 1s, 2 = 4s

async function deliverOne(
  webhookId: string,
  url: string,
  secret: string,
  payloadJson: string,
  event: WebhookEvent,
): Promise<void> {
  // Sealed at rest; rows from before that are plain (openStoredSecret).
  let signature: string
  try {
    signature = signPayload(openStoredSecret(secret), payloadJson)
  } catch {
    console.error(`[webhook] signing secret of ${webhookId} could not be read — not delivered`)
    return
  }
  let lastStatus = 0
  let delivered = false

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (RETRY_DELAYS_MS[i] > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      // safeFetch: the address is checked at connection time, so a name
      // re-pointed at an internal host after saving is still refused.
      const res = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CRM-Signature': signature,
          'X-CRM-Event': event,
          'User-Agent': 'WhatsApp-CRM-Webhook/1.0',
        },
        body: payloadJson,
        // Reject redirects to prevent redirect-based SSRF; the registered
        // URL must be the final destination.
        redirect: 'error',
      }, { timeoutMs: 10_000, maxBytes: 64 * 1024 })
      // The body is not used; release the socket.
      await res.body?.cancel().catch(() => {})
      lastStatus = res.status
      if (res.ok) {
        delivered = true
        break
      }
    } catch (err) {
      // A refused destination will not change on retry.
      if (err instanceof SsrfBlockedError) {
        console.warn(`[webhook] ${webhookId} points at an internal address — not delivered`)
        break
      }
      // Network error or timeout — try next attempt
    }
  }

  if (delivered) {
    await prisma.webhook
      .update({
        where: { id: webhookId },
        data: {
          last_triggered_at: new Date(),
          last_response_status: lastStatus,
          failure_count: 0,
        },
      })
      .catch(() => {})
    return
  }

  // Failure: increment counter and auto-disable at threshold
  const updated = await prisma.webhook
    .update({
      where: { id: webhookId },
      data: {
        last_triggered_at: new Date(),
        last_response_status: lastStatus || null,
        failure_count: { increment: 1 },
      },
      select: { failure_count: true },
    })
    .catch(() => null)

  if (updated && updated.failure_count >= MAX_FAILURES) {
    await prisma.webhook
      .update({ where: { id: webhookId }, data: { is_active: false } })
      .catch(() => {})
    console.warn(`[webhook] auto-disabled ${webhookId} after ${MAX_FAILURES} consecutive failures`)
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
