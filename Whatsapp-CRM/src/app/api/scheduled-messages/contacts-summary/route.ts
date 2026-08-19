import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/scheduled-messages/contacts-summary
 *
 * Account-wide view: every contact that has at least one scheduled
 * message, with per-contact counts grouped into Pending (active/paused),
 * Completed, and Error (failed/expired). Used by the Inbox-level
 * "scheduled messages across contacts" overview (separate from the
 * per-conversation panel).
 */
export async function GET() {
  try {
    const ctx = await requireRole("viewer")

    const rows = await prisma.scheduledMessage.findMany({
      where: { account_id: ctx.accountId },
      select: { contact_id: true, conversation_id: true, status: true },
    })
    if (rows.length === 0) return NextResponse.json({ items: [] })

    const contactIds = [...new Set(rows.map((r) => r.contact_id))]
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, account_id: ctx.accountId },
      select: { id: true, name: true, phone: true },
    })
    const contactById = new Map(contacts.map((c) => [c.id, c]))

    const summary = new Map<string, {
      contact_id: string
      name: string
      phone: string
      conversation_id: string
      pending: number
      completed: number
      error: number
    }>()

    for (const row of rows) {
      const contact = contactById.get(row.contact_id)
      if (!contact) continue // contact deleted since the schedule was created
      let entry = summary.get(row.contact_id)
      if (!entry) {
        entry = {
          contact_id: row.contact_id,
          name: contact.name || contact.phone,
          phone: contact.phone,
          conversation_id: row.conversation_id,
          pending: 0,
          completed: 0,
          error: 0,
        }
        summary.set(row.contact_id, entry)
      }
      if (row.status === "active" || row.status === "paused") entry.pending++
      else if (row.status === "completed") entry.completed++
      else if (row.status === "failed" || row.status === "expired") entry.error++
      // 'cancelled' rows are excluded from all three counts on purpose --
      // they're neither pending, successful, nor an error to look into.
    }

    const items = [...summary.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name))
    return NextResponse.json({ items })
  } catch (err) {
    return toErrorResponse(err)
  }
}
