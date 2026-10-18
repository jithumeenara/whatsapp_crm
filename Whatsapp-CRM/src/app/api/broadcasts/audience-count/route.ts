import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { sendableContactWhere } from "@/lib/broadcasts/sendable"
import { contactsInList, contactsInOutcome } from "@/lib/broadcasts/outcome-audience"
import { isOutcome } from "@/lib/broadcasts/outcomes"

interface AudienceCountBody {
  type: string
  tagIds?: string[]
  customField?: {
    fieldId: string
    operator: "is" | "is_not" | "contains"
    value: string
  }
  csvContacts?: { phone: string }[]
  contactIds?: string[]
  excludeTagIds?: string[]
  fromBroadcast?: { broadcastId: string; outcome: string }
  listId?: string
}

/**
 * POST /api/broadcasts/audience-count
 * Returns an estimated recipient count for the given audience config.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer")
    const db = ctx.db
    const body = (await req.json()) as AudienceCountBody

    if (body.type === "csv") {
      return NextResponse.json({ count: body.csvContacts?.length ?? 0 })
    }
    // Every count below uses the same rule as the send itself
    // (src/lib/broadcasts/sendable.ts), inside this account only.
    const sendable = sendableContactWhere(ctx.accountId)

    let excludeIds: string[] = []
    if (body.excludeTagIds && body.excludeTagIds.length > 0) {
      const rows = await db.contactTag.findMany({
        where: { tag_id: { in: body.excludeTagIds.slice(0, 200) } },
        select: { contact_id: true },
      })
      excludeIds = [...new Set(rows.map((r) => r.contact_id))]
    }
    const notExcluded = excludeIds.length ? { id: { notIn: excludeIds } } : {}

    if (body.type === "contacts") {
      const ids = (body.contactIds ?? []).filter((id) => typeof id === "string").slice(0, 10_000)
      if (ids.length === 0) return NextResponse.json({ count: 0 })
      const count = await db.contact.count({ where: { AND: [sendable, { id: { in: ids } }, notExcluded] } })
      return NextResponse.json({ count })
    }

    if (body.type === "all") {
      const count = await db.contact.count({ where: { AND: [sendable, notExcluded] } })
      return NextResponse.json({ count })
    }

    let baseIds: string[]
    if (body.type === "tags" && body.tagIds && body.tagIds.length > 0) {
      const rows = await db.contactTag.findMany({
        where: { tag_id: { in: body.tagIds.slice(0, 200) } },
        select: { contact_id: true },
      })
      baseIds = [...new Set(rows.map((r) => r.contact_id))]
    } else if (body.type === "custom_field" && body.customField?.fieldId && body.customField.value) {
      const { fieldId, operator, value } = body.customField
      let valueFilter: unknown
      if (operator === "is") valueFilter = { equals: value }
      else if (operator === "is_not") valueFilter = { not: value }
      else valueFilter = { contains: value, mode: "insensitive" }

      const rows = await db.contactCustomValue.findMany({
        where: { custom_field_id: fieldId, value: valueFilter as never },
        select: { contact_id: true },
      })
      baseIds = [...new Set(rows.map((r) => r.contact_id))]
    } else if (body.type === "broadcast_outcome" && body.fromBroadcast && isOutcome(body.fromBroadcast.outcome)) {
      baseIds = (await contactsInOutcome(db, ctx.accountId, String(body.fromBroadcast.broadcastId), body.fromBroadcast.outcome)) ?? []
    } else if (body.type === "list" && typeof body.listId === "string") {
      baseIds = (await contactsInList(db, ctx.accountId, body.listId)) ?? []
    } else {
      return NextResponse.json({ count: null })
    }

    if (baseIds.length === 0) return NextResponse.json({ count: 0 })
    const count = await db.contact.count({ where: { AND: [sendable, { id: { in: baseIds } }, notExcluded] } })
    return NextResponse.json({ count })
  } catch (err) {
    return toErrorResponse(err)
  }
}
