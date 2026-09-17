/**
 * Telling somebody when a stranger writes in for the first time.
 *
 * The other half of the handoff alert. That one fires when the assistant
 * gives up; this fires at the opposite end of the conversation, when a
 * number nobody has seen before starts one. For a business that treats
 * every new enquiry as a lead, that first message is the moment worth
 * knowing about — and until now it was visible only to whoever happened
 * to have the Inbox open at the time.
 *
 * Off by default, because an account taking hundreds of new contacts a
 * day should not be woken by all of them without having asked.
 */

import { prisma } from '@/lib/db'
import { sendStaffAlert, cleanNumbers, templateSafe } from '@/lib/whatsapp/staff-alert'

export interface NewContactAlertInput {
  accountId: string
  contact: { name: string | null; phone: string }
  /** What they opened with. Often the most useful line in the alert. */
  firstMessage: string
  /** 'whatsapp' | 'instagram' | … — worth naming when an account runs
   *  more than one channel. */
  channel?: string
}

/**
 * Never throws and never awaited into anything that matters.
 *
 * This runs after a contact has already been created and their message
 * already stored. An undeliverable alert is worth a log line and nothing
 * more; it must not cost the account the inbound message.
 */
export async function sendNewContactAlert(input: NewContactAlertInput): Promise<void> {
  try {
    const config = await prisma.contactCaptureConfig.findUnique({
      where: { account_id: input.accountId },
      select: {
        new_contact_alert_enabled: true,
        new_contact_alert_numbers: true,
        new_contact_alert_template: true,
      },
    })
    if (!config?.new_contact_alert_enabled) return
    if (cleanNumbers(config.new_contact_alert_numbers).length === 0) return

    const who = input.contact.name?.trim() || 'Unknown name'
    const phone = input.contact.phone
    const quote = templateSafe(input.firstMessage)
    const channel = input.channel ?? 'whatsapp'

    await sendStaffAlert({
      accountId: input.accountId,
      numbers: config.new_contact_alert_numbers,
      template: config.new_contact_alert_template,
      templateParams: [who, phone, quote, channel],
      label: 'new-contact-alert',
      text: [
        '👋 A new contact just messaged.',
        '',
        `Name: ${who}`,
        `Number: ${phone}`,
        `Channel: ${channel}`,
        '',
        `They said: "${quote}"`,
      ].join('\n'),
    })
  } catch (err) {
    console.error(
      '[new-contact-alert] failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
