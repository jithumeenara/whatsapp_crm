/**
 * Sending a short operational message to the business's own staff.
 *
 * Extracted because there are now two reasons to do it — the assistant
 * handing a conversation over, and a stranger writing in for the first
 * time — and the hard parts are identical for both. Two copies would
 * eventually disagree about the part that is easy to get wrong.
 *
 * ── The 24-hour rule, which is the whole difficulty ─────────────────
 *
 * Meta only allows a free-form business-initiated message inside a
 * 24-hour window that the *recipient* opens by writing to the business
 * first. A staff member who never messages the business number is
 * permanently outside it, and a plain-text alert to them does not
 * arrive and does not error either — it is simply never delivered.
 *
 * So an approved Utility template is the supported path and every UI
 * that offers this says so. Free-form stays as the fallback because it
 * genuinely works for staff who do chat with the business number, and an
 * alert that arrives sometimes beats one that never does. What this
 * module will not do is pretend: every failure comes back with the
 * number it failed for.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

export interface StaffAlertResult {
  sent: number
  failed: Array<{ to: string; error: string }>
}

export interface StaffAlertInput {
  accountId: string
  /** Raw as configured; cleaned and filtered here. */
  numbers: unknown
  /** Name of an approved Utility template, or null for plain text. */
  template: string | null
  /** The plain-text body, already written for a person to read. */
  text: string
  /** Template variables, in the template's own order. Ignored when no
   *  template is configured. */
  templateParams: string[]
  /** Prefixes the log lines, so two callers are distinguishable. */
  label: string
}

/** Digits only, and long enough to be a real number. These become
 *  WhatsApp recipients; anything else fails at Meta with an error
 *  nobody is looking for. */
export function cleanNumbers(raw: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(raw) ? raw : [])
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.replace(/[^\d]/g, ''))
        .filter((n) => n.length >= 8 && n.length <= 15),
    ),
  )
}

/** Template parameters may not contain newlines, tabs, or four-plus
 *  consecutive spaces — Meta rejects the whole send with a 132000-series
 *  error that says nothing about which parameter was at fault. */
export function templateSafe(text: string, max = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max) || '(none)'
}

/**
 * Sends to each number in turn, and reports honestly what happened.
 *
 * Never throws: every caller is on the tail of something more important
 * that has already succeeded, and an undeliverable alert must not undo
 * it. Sequential rather than parallel — these go to a handful of staff
 * numbers, and Meta rate-limits per number, so a burst buys nothing and
 * costs a 429 that would look like a bug.
 */
export async function sendStaffAlert(input: StaffAlertInput): Promise<StaffAlertResult> {
  const result: StaffAlertResult = { sent: 0, failed: [] }
  const numbers = cleanNumbers(input.numbers)
  if (numbers.length === 0) return result

  let phoneNumberId: string
  let accessToken: string
  try {
    const config = await resolveWhatsAppConfig({ accountId: input.accountId })
    phoneNumberId = config.phone_number_id
    accessToken = decrypt(config.access_token)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[${input.label}] no WhatsApp number to send from:`, message)
    return { sent: 0, failed: [{ to: '(all)', error: message }] }
  }

  for (const to of numbers) {
    try {
      if (input.template) {
        const template = await prisma.messageTemplate.findFirst({
          where: { account_id: input.accountId, name: input.template, status: 'APPROVED' },
        })
        if (!template) {
          throw new Error(
            `Template "${input.template}" is not approved on this account. Sync templates from Meta, or clear the template to fall back to plain text.`,
          )
        }
        // The stored row is wider than the send helper's type — the
        // project's own guard narrows it rather than a cast, so a row
        // missing body_text fails here with a sentence instead of
        // somewhere inside Meta's component builder.
        if (!isMessageTemplate(template)) {
          throw new Error(`Template "${template.name}" is stored incomplete — re-sync from Meta.`)
        }
        await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to,
          templateName: template.name,
          language: template.language ?? 'en_US',
          template,
          messageParams: { body: input.templateParams.map((p) => templateSafe(p)) },
        })
      } else {
        await sendTextMessage({ phoneNumberId, accessToken, to, text: input.text })
      }
      result.sent += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failed.push({ to, error: message })
      console.error(`[${input.label}] could not reach`, to, '—', message)
    }
  }

  return result
}
