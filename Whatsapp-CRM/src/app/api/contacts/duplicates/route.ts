import { isPlaceholderPhone } from "@/lib/contacts/validate"
import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { findDuplicateGroups } from "@/lib/contacts/duplicates"

/**
 * GET /api/contacts/duplicates
 *
 * Contacts that are probably one person (src/lib/contacts/duplicates.ts):
 * same number, same email, or an alternate number that is another's
 * number. Groups only — nothing is merged here.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const contacts = await ctx.db.contact.findMany({
      where: { account_id: ctx.accountId, merged_into_contact_id: null, archived_at: null },
      select: { id: true, name: true, phone: true, alternate_phone: true, email: true, created_at: true },
      take: 50_000,
    })
    // How much history each candidate has, so the busier record is kept.
    const raw = findDuplicateGroups(contacts)
    const ids = raw.flatMap((g) => g.contacts.map((c) => c.id))
    const [convs, lastSeen] = ids.length
      ? await Promise.all([
          ctx.db.conversation.groupBy({ by: ["contact_id"], where: { account_id: ctx.accountId, contact_id: { in: ids } }, _count: { _all: true } }),
          ctx.db.conversation.groupBy({ by: ["contact_id"], where: { account_id: ctx.accountId, contact_id: { in: ids } }, _max: { last_message_at: true } }),
        ])
      : [[], []]
    const activity = new Map(convs.map((c) => [c.contact_id, c._count._all]))
    const last = new Map(lastSeen.map((c) => [c.contact_id, c._max.last_message_at]))
    const groups = findDuplicateGroups(
      contacts.filter((c) => ids.includes(c.id)).map((c) => ({ ...c, activity: activity.get(c.id) ?? 0 })),
    )
    return NextResponse.json({
      total: groups.length,
      groups: groups.map((g) => ({
        reasons: g.reasons,
        contacts: g.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone && !isPlaceholderPhone(c.phone) ? c.phone : null,
          email: c.email,
          conversations: c.activity ?? 0,
          last_message_at: last.get(c.id) ?? null,
          created_at: c.created_at,
        })),
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
