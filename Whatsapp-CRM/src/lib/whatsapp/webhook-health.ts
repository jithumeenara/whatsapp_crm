/**
 * What has Meta actually delivered to this server?
 *
 * "Connected" on the settings page used to mean only that the WhatsApp
 * account was subscribed once — it said nothing about whether messages
 * arrive here. This keeps the evidence: when a genuine (signed) webhook
 * last came in for each number, and when one was last turned away and
 * why. The connection test reads it to say "messages are arriving" or
 * "Meta is sending, but this server rejects them".
 *
 * In memory, on globalThis so the webhook route and the settings route —
 * bundled separately — see the same record. It starts empty when the
 * server restarts, and the diagnostic says "since <start>" accordingly.
 * Holds no message content and no customer numbers: only our own
 * business phone-number IDs and timestamps.
 */

import type { SignatureCheck } from './webhook-signature'

interface HealthState {
  startedAt: number
  /** Business phone_number_id → last genuine webhook for it. */
  delivered: Map<string, number>
  rejected: { at: number; reason: SignatureCheck; count: number } | null
}

const KEY = Symbol.for('crm.whatsapp.webhook-health')
const MAX_NUMBERS = 1000

function state(): HealthState {
  const g = globalThis as unknown as Record<symbol, HealthState | undefined>
  let s = g[KEY]
  if (!s) {
    s = { startedAt: Date.now(), delivered: new Map(), rejected: null }
    g[KEY] = s
  }
  return s
}

/** Call only for a request whose signature checked out. */
export function noteDelivered(body: unknown, now = Date.now()): void {
  const entries = (body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: unknown } } }[] }[] })?.entry
  if (!Array.isArray(entries)) return
  const s = state()
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id
      if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) continue
      if (!s.delivered.has(id) && s.delivered.size >= MAX_NUMBERS) continue
      s.delivered.set(id, now)
    }
  }
}

/** A request turned away. Requests with no signature at all are not
 *  Meta's (scanners, curl) and are not counted. */
export function noteRejected(reason: SignatureCheck, now = Date.now()): void {
  if (reason === 'ok' || reason === 'no_signature') return
  const s = state()
  s.rejected = { at: now, reason, count: (s.rejected?.count ?? 0) + 1 }
}

export interface DeliveryRecord {
  since: string
  lastDeliveredAt: string | null
  rejected: { at: string; reason: SignatureCheck; count: number } | null
}

export function deliveryRecord(phoneNumberId: string): DeliveryRecord {
  const s = state()
  const last = s.delivered.get(phoneNumberId)
  return {
    since: new Date(s.startedAt).toISOString(),
    lastDeliveredAt: last ? new Date(last).toISOString() : null,
    rejected: s.rejected ? { ...s.rejected, at: new Date(s.rejected.at).toISOString() } : null,
  }
}

/** For tests only. */
export function resetWebhookHealth(now = Date.now()): void {
  const s = state()
  s.startedAt = now
  s.delivered.clear()
  s.rejected = null
}
