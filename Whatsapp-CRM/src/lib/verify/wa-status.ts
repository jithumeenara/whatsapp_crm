/**
 * Meta's delivery report for a "check your details" link sent on WhatsApp.
 * Its own small file: the webhook imports it, and should not pull in the
 * Google, SMS and email code the rest of the feature needs.
 */

import { prisma } from '@/lib/db'
import { failureText } from '@/lib/whatsapp/meta-error-codes'

const LADDER = ['sent', 'delivered', 'read']

export async function applyVerifyWhatsAppStatus(status: {
  id: string
  status: string
  errors?: Array<{ code?: number; title?: string; message?: string }>
}): Promise<void> {
  const person = await prisma.sheetVerificationPerson.findFirst({
    where: { wa_message_id: status.id },
    select: { id: true, wa_status: true },
  })
  if (!person) return
  if (status.status === 'failed') {
    const why = status.errors?.[0]?.code === 131026 ? 'Not on WhatsApp, or cannot receive messages' : failureText(status.errors)
    await prisma.sheetVerificationPerson.update({
      where: { id: person.id },
      data: { wa_status: 'failed', wa_error: (why || 'WhatsApp could not deliver it').slice(0, 300) },
    })
    return
  }
  // Forward only: a late "delivered" never undoes "read".
  if (LADDER.indexOf(status.status) > LADDER.indexOf(person.wa_status ?? '')) {
    await prisma.sheetVerificationPerson.update({ where: { id: person.id }, data: { wa_status: status.status } })
  }
}
