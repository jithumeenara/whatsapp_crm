import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/contacts/[id]/delete-impact
 *
 * What disappears if this contact is deleted.
 *
 * ── Why a warning needs numbers ─────────────────────────────────────
 *
 * "This cannot be undone" is on every delete dialog ever written and
 * carries no information: it is true of deleting an empty contact
 * somebody typed by mistake and equally true of deleting eighteen
 * months of conversation with a customer who bought twice. The person
 * clicking has to be able to tell those apart, and only the counts do
 * that.
 *
 * ── Why closed-won leads are counted separately ─────────────────────
 *
 * A won lead is not a record of a person; it is a record of money
 * coming in, and it is what every conversion figure on the Reports
 * screen is computed from. Deleting one silently rewrites history that
 * somebody may be reporting to a bank or an owner.
 *
 * This endpoint does not refuse — the account's own data is theirs to
 * remove, and refusing would only send them to the database. It makes
 * the cost visible at the moment of the decision, which is the last
 * point at which it can be reconsidered.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, name: true, phone: true },
    })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const conversationIds = (
      await prisma.conversation.findMany({
        where: { contact_id: id },
        select: { id: true },
      })
    ).map((c) => c.id)

    const [leads, wonLeads, messages, notes, followUps, tasks, deals] = await Promise.all([
      prisma.lead.count({ where: { contact_id: id } }),
      // Closed and converted. The half of the count worth hesitating
      // over.
      prisma.lead.count({ where: { contact_id: id, converted_at: { not: null } } }),
      conversationIds.length > 0
        ? prisma.message.count({ where: { conversation_id: { in: conversationIds } } })
        : Promise.resolve(0),
      prisma.contactNote.count({ where: { contact_id: id } }),
      prisma.followUp.count({ where: { contact_id: id } }),
      prisma.task.count({ where: { contact_id: id } }),
      prisma.deal.count({ where: { contact_id: id } }),
    ])

    return NextResponse.json({
      contact: { name: contact.name, phone: contact.phone },
      conversations: conversationIds.length,
      messages,
      leads,
      won_leads: wonLeads,
      notes,
      follow_ups: followUps,
      tasks,
      deals,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
