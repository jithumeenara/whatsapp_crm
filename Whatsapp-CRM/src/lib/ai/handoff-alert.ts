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
 * ── The 24-hour problem, stated plainly ─────────────────────────────
 *
 * Meta only allows a free-form business-initiated message inside a
 * 24-hour window that the *recipient* opens by writing to the business
 * first. A staff member who never messages the business number is
 * permanently outside it, and a plain-text alert to them silently does
 * not arrive. No amount of code changes that.
 *
 * So a template is the supported path and the UI says so. Free-form is
 * kept as the fallback because it genuinely works for staff who do chat
 * with the business number, and because an alert that arrives sometimes
 * beats one that never does. What this module will not do is pretend:
 * every failure is returned, counted, and logged with the number it
 * failed for.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

/** Kept short: it becomes a template variable, and Meta rejects a
 *  parameter containing a newline or a run of spaces. */
const MAX_QUOTE_CHARS = 180

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

/** Template parameters may not contain newlines, tabs, or four-plus
 *  consecutive spaces — Meta rejects the whole send with a 132000-series
 *  error that says nothing useful about which parameter was at fault. */
function templateSafe(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS) || '(no message)'
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

    const numbers = asStringArray(aiConfig.handoff_alert_numbers)
      .map((n) => n.replace(/[^\d]/g, ''))
      .filter((n) => n.length >= 8)
    if (numbers.length === 0) return { ...empty, skipped: 'no_numbers' }

    // An empty list means every reason. Anything else is an opt-in, so a
    // business that only wants to hear about refusals is not woken by
    // every unanswered opening-hours question.
    const wanted = asStringArray(aiConfig.handoff_alert_reasons)
    if (wanted.length > 0 && !wanted.includes(input.reason)) {
      return { ...empty, skipped: 'reason_filtered' }
    }

    const config = await resolveWhatsAppConfig({ accountId: input.accountId })
    const accessToken = decrypt(config.access_token)

    const who = input.contact?.name?.trim() || input.contact?.phone || 'a customer'
    const phone = input.contact?.phone ?? 'unknown'
    const quote = templateSafe(input.customerMessage)

    const result: HandoffAlertResult = { sent: 0, failed: [], skipped: null }

    // Sequentially, not in parallel. These go to a handful of staff
    // numbers at most, and Meta rate-limits per number — a burst buys
    // nothing here and costs a 429 that would look like a bug.
    for (const to of numbers) {
      try {
        if (aiConfig.handoff_alert_template) {
          const template = await prisma.messageTemplate.findFirst({
            where: {
              account_id: input.accountId,
              name: aiConfig.handoff_alert_template,
              status: 'APPROVED',
            },
          })
          if (!template) {
            throw new Error(
              `Template "${aiConfig.handoff_alert_template}" is not approved on this account. Sync templates from Meta, or clear the template to fall back to plain text.`,
            )
          }
          // The stored row is wider than the send helper's type — the
          // project's own guard narrows it rather than a cast, so a row
          // missing body_text fails here with a sentence instead of
          // somewhere inside Meta's component builder.
          if (!isMessageTemplate(template)) {
            throw new Error(
              `Template "${template.name}" is stored incomplete — re-sync templates from Meta.`,
            )
          }
          await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to,
            templateName: template.name,
            language: template.language ?? 'en_US',
            template,
            messageParams: { body: [who, phone, quote, input.reason.replace(/_/g, ' ')] },
          })
        } else {
          await sendTextMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to,
            text: [
              '🔔 A customer needs a person.',
              '',
              `From: ${who}`,
              `Number: ${phone}`,
              `Reason: ${input.reason.replace(/_/g, ' ')}`,
              '',
              `They said: "${quote}"`,
            ].join('\n'),
          })
        }
        result.sent += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.failed.push({ to, error: message })
        console.error('[handoff-alert] could not reach', to, '—', message)
      }
    }

    return result
  } catch (err) {
    console.error('[handoff-alert] failed:', err instanceof Error ? err.message : err)
    return { ...empty, failed: [{ to: '(all)', error: err instanceof Error ? err.message : String(err) }] }
  }
}
