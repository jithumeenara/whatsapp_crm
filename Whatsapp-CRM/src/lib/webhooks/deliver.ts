import { createHmac, randomBytes } from 'crypto'
import { prisma } from '@/lib/db'

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
// Block private / loopback / link-local ranges in IPv4 and common IPv6 forms.
const PRIVATE_IP_RE =
  /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::]', '[::1]'])

/**
 * Validate and normalise a webhook URL.
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
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error('Webhook URL must not point to localhost.')
  }
  if (PRIVATE_IP_RE.test(host)) {
    throw new Error('Webhook URL must not point to a private or reserved IP address.')
  }
  return parsed.toString()
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
  const signature = signPayload(secret, payloadJson)
  let lastStatus = 0
  let delivered = false

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (RETRY_DELAYS_MS[i] > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      const res = await fetch(url, {
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
        signal: AbortSignal.timeout(10_000),
      })
      lastStatus = res.status
      if (res.ok) {
        delivered = true
        break
      }
    } catch {
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
