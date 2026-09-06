/**
 * Handlers for Meta's account/phone-number-level alert webhook fields.
 *
 * These are distinct from template-lifecycle events (see template-webhook.ts)
 * and from inbound messages/statuses — they carry account health signals
 * that today are fetched-and-discarded (or not fetched at all): the number's
 * quality rating changing, Meta pushing a generic account alert, a display
 * name review decision, an account review decision, or a security event.
 *
 * Unlike messages (keyed by phone_number_id, present in value.metadata),
 * these payloads don't reliably carry phone_number_id in a consistent
 * shape across fields — but every field arrives under the same webhook
 * `entry`, and `entry.id` is always the WABA ID for a WhatsApp Business
 * Account object. That's the one identifier guaranteed present regardless
 * of which of these fields fired, so we resolve the owning tenant by
 * waba_id rather than trying to parse a phone number out of each field's
 * differently-shaped value.
 *
 * This is intentionally push-notification-only — there is no persisted
 * in-app alert/notification history table in this schema today, and
 * building one is a larger, separate feature. A single debounce column
 * (WhatsAppConfig.last_alert_notified_at) keeps a webhook redelivery from
 * re-notifying the same underlying alert every time Meta retries.
 */

import { prisma } from '@/lib/db'

const ACCOUNT_ALERT_FIELDS = new Set([
  'phone_number_quality_update',
  'account_alerts',
  'phone_number_name_update',
  'account_review_update',
  'security',
])

export function isAccountAlertField(field: string): boolean {
  return ACCOUNT_ALERT_FIELDS.has(field)
}

export interface AccountAlertChange {
  field: string
  value: unknown
}

// Redelivery/retry debounce — Meta can resend the same webhook event
// multiple times; this isn't meant to distinguish repeated *different*
// alerts of the same field, just to stop one underlying event from
// pushing the same notification over and over in a short window.
const ALERT_DEBOUNCE_MS = 5 * 60 * 1000

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

const FIELD_COPY: Record<string, { title: string; body: (v: Record<string, unknown>) => string }> = {
  phone_number_quality_update: {
    title: 'WhatsApp number quality changed',
    body: (v) => {
      const event = str(v.event)
      const phone = str(v.display_phone_number)
      return `Quality rating${phone ? ` for ${phone}` : ''} is now ${event ?? 'updated'}. Check Settings for details.`
    },
  },
  account_alerts: {
    title: 'WhatsApp account alert from Meta',
    body: (v) =>
      str(v.alert_description) || str(v.alert_type) || 'Meta sent an account alert — check Meta Business Manager for details.',
  },
  phone_number_name_update: {
    title: 'Display name review update',
    body: (v) => {
      const decision = str(v.decision)
      const phone = str(v.display_phone_number)
      return `Meta ${decision === 'APPROVED' ? 'approved' : 'reviewed'} your display name change${phone ? ` for ${phone}` : ''}.`
    },
  },
  account_review_update: {
    title: 'WhatsApp account review update',
    body: (v) => `Meta's review decision: ${str(v.decision) ?? 'updated'}.`,
  },
  security: {
    title: 'Security alert on your WhatsApp number',
    body: () => 'Meta flagged a security-related event on your WhatsApp Business Account — check Meta Business Manager.',
  },
}

/**
 * Dispatch a single change record. Best-effort throughout — a failure
 * here must never affect webhook ack or any other change in the batch.
 */
export async function handleAccountAlertChange(change: AccountAlertChange, wabaId: string): Promise<void> {
  const copy = FIELD_COPY[change.field]
  if (!copy) return // defensive; isAccountAlertField already filtered

  let configRows: { id: string; user_id: string; last_alert_notified_at: Date | null }[]
  try {
    configRows = await prisma.whatsAppConfig.findMany({
      where: { waba_id: wabaId },
      select: { id: true, user_id: true, last_alert_notified_at: true },
    })
  } catch (err) {
    console.error('[account-webhook] failed to look up WhatsAppConfig for waba_id', wabaId, err)
    return
  }

  if (configRows.length === 0) {
    console.warn('[account-webhook] no WhatsAppConfig found for waba_id', wabaId, '— alert dropped:', change.field)
    return
  }
  if (configRows.length > 1) {
    console.warn(
      `[account-webhook] ${configRows.length} configs matched waba_id ${wabaId} — notifying all, but this WABA should map to exactly one tenant.`,
    )
  }

  const body = copy.body(asRecord(change.value))

  for (const config of configRows) {
    if (
      config.last_alert_notified_at &&
      Date.now() - config.last_alert_notified_at.getTime() < ALERT_DEBOUNCE_MS
    ) {
      continue
    }

    try {
      const { sendPushToUser } = await import('@/lib/push')
      void sendPushToUser(config.user_id, {
        title: copy.title,
        body,
        tag: `wa-alert-${change.field}`,
        data: { type: 'whatsapp_account_alert', field: change.field },
      })
    } catch (err) {
      console.error('[account-webhook] push notification failed:', err)
    }

    await prisma.whatsAppConfig
      .update({ where: { id: config.id }, data: { last_alert_notified_at: new Date() } })
      .catch((err) => console.error('[account-webhook] failed to stamp last_alert_notified_at:', err))
  }
}
