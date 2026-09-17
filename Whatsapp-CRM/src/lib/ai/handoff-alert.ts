/**
 * Telling a person, on WhatsApp, when the assistant gives up.
 *
 * A handover writes a note onto the conversation. That note is exactly
 * right for whoever opens the conversation, and reaches nobody who
 * doesn't. For a business whose staff live in WhatsApp rather than in a
 * CRM tab, a lead the assistant could not close sits in Pending until
 * somebody happens to look — which is often the next morning, by which
 * point the customer has asked somebody else.
 *
 * The delivery itself lives in `@/lib/whatsapp/staff-alert`, shared with
 * the new-contact alert. What stays here is the part specific to a
 * handover: which reasons are worth interrupting somebody for, and what
 * the message says.
 */

import { prisma } from '@/lib/db'
import { sendStaffAlert, cleanNumbers, templateSafe } from '@/lib/whatsapp/staff-alert'

export interface HandoffAlertInput {
  accountId: string
  conversationId: string
  /** Why the assistant stopped — the same key the handoff note uses. */
  reason: string
  customerMessage: string
  contact: { name: string | null; phone: string } | null
}

export interface HandoffAlertResult {
  sent: number
  failed: Array<{ to: string; error: string }>
  skipped: 'disabled' | 'no_numbers' | 'reason_filtered' | null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Sends the alert, and reports honestly what happened to it.
 *
 * Never throws. This runs on the tail of a handover that has already
 * done the important thing — the conversation is flagged and the note is
 * written — and failing here must not undo that or take down the reply
 * path with it.
 */
export async function sendHandoffAlert(input: HandoffAlertInput): Promise<HandoffAlertResult> {
  const empty: HandoffAlertResult = { sent: 0, failed: [], skipped: null }
  try {
    const aiConfig = await prisma.aiConfig.findUnique({
      where: { account_id: input.accountId },
      select: {
        handoff_alert_enabled: true,
        handoff_alert_numbers: true,
        handoff_alert_template: true,
        handoff_alert_reasons: true,
      },
    })
    if (!aiConfig?.handoff_alert_enabled) return { ...empty, skipped: 'disabled' }
    if (cleanNumbers(aiConfig.handoff_alert_numbers).length === 0) {
      return { ...empty, skipped: 'no_numbers' }
    }

    // An empty list means every reason. Anything else is an opt-in, so a
    // business that only wants to hear about refusals is not woken by
    // every unanswered opening-hours question.
    const wanted = asStringArray(aiConfig.handoff_alert_reasons)
    if (wanted.length > 0 && !wanted.includes(input.reason)) {
      return { ...empty, skipped: 'reason_filtered' }
    }

    const who = input.contact?.name?.trim() || input.contact?.phone || 'a customer'
    const phone = input.contact?.phone ?? 'unknown'
    const quote = templateSafe(input.customerMessage)
    const reason = input.reason.replace(/_/g, ' ')

    const { sent, failed } = await sendStaffAlert({
      accountId: input.accountId,
      numbers: aiConfig.handoff_alert_numbers,
      template: aiConfig.handoff_alert_template,
      templateParams: [who, phone, quote, reason],
      label: 'handoff-alert',
      text: [
        '🔔 A customer needs a person.',
        '',
        `From: ${who}`,
        `Number: ${phone}`,
        `Reason: ${reason}`,
        '',
        `They said: "${quote}"`,
      ].join('\n'),
    })

    return { sent, failed, skipped: null }
  } catch (err) {
    console.error('[handoff-alert] failed:', err instanceof Error ? err.message : err)
    return { ...empty, failed: [{ to: '(all)', error: err instanceof Error ? err.message : String(err) }] }
  }
}
