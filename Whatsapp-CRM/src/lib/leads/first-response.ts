/**
 * The first reply a person gave a lead, for reports (migration 158):
 * leads.first_response_at / first_response_by.
 *
 * Called only from a send that a signed-in staff member made by hand
 * (POST /api/whatsapp/send with a session). The bot, the AI auto-reply,
 * broadcasts, automations and API-key integrations write messages with
 * sender_type 'agent' too, so the message row alone cannot tell them
 * apart — the call site is what says "a person did this".
 *
 * One conditional updateMany: only leads of this contact, in this
 * account, still open, created before the reply, and not stamped yet.
 * Two sends at once stamp once; a second send changes nothing.
 *
 * Never throws — a report column must not fail or slow a message.
 */

import { prisma } from '@/lib/db'

export async function stampFirstResponse(args: {
  accountId: string
  contactId: string
  userId: string
  at?: Date
}): Promise<number> {
  if (!args.accountId || !args.contactId || !args.userId) return 0
  const at = args.at ?? new Date()
  try {
    const res = await prisma.lead.updateMany({
      where: {
        account_id: args.accountId,
        contact_id: args.contactId,
        first_response_at: null,
        created_at: { lte: at },
        status: { not: 'closed' },
      },
      data: { first_response_at: at, first_response_by: args.userId },
    })
    return res.count
  } catch (err) {
    console.error('[leads] first response stamp failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
