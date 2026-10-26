import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account"
import { liveSendableContactWhere } from "@/lib/broadcasts/sendable"
import { contactsInList, contactsInOutcome } from "@/lib/broadcasts/outcome-audience"
import { isOutcome } from "@/lib/broadcasts/outcomes"
import { engagementDays, engagementWhere, isEngagementKind } from "@/lib/broadcasts/engagement"
import { hasTagRules, tagAudienceWhere, tagRuleError, tagsBelongToAccount } from "@/lib/broadcasts/tag-audience"
import { loadTableRule, phoneColumns, tableAudienceMatch, tableRuleError, tableSheetSync, type TableAudience } from "@/lib/broadcasts/table-audience"

interface AudienceCountBody {
  type: string
  tagIds?: string[]
  tagMatch?: "any" | "all"
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
  engagement?: { kind?: string; days?: number }
  table?: TableAudience
}

/**
 * POST /api/broadcasts/audience-count
 * Returns an estimated recipient count for the given audience config.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer")
    assertPageAccess(ctx, "/broadcasts")
    const db = ctx.db
    const body = (await req.json()) as AudienceCountBody

    if (body.type === "csv") {
      return NextResponse.json({ count: body.csvContacts?.length ?? 0 })
    }
    // Every count below uses the same rule as the send itself
    // (src/lib/broadcasts/sendable.ts), inside this account only.
    const sendable = liveSendableContactWhere(ctx.accountId)

    // Rows of a table that meet one rule — the same rule as the send. Also
    // says how many rows matched, how many of their numbers are no
    // contact's, and when a linked Google Sheet last synced.
    if (body.type === "table") {
      const problem = tableRuleError(body.table)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      const loaded = await loadTableRule(ctx.accountId, body.table!)
      if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 400 })
      const [match, sync] = await Promise.all([
        tableAudienceMatch(ctx.accountId, body.table!, phoneColumns(loaded.table.fields)),
        tableSheetSync(ctx.accountId, loaded.table.id),
      ])
      if (match.tooMany) return NextResponse.json({ error: "More than 20,000 people match this rule. Narrow it down (for example by batch or month)." }, { status: 400 })
      const count = match.contactIds.length
        ? await db.contact.count({ where: { AND: [sendable, { id: { in: match.contactIds } }] } })
        : 0
      return NextResponse.json({ count, rows: match.rows, notContacts: match.notContacts, sync })
    }

    // Contains (any/all) and Does not contain — the same rule as the send.
    if (body.type === "tags") {
      const problem = tagRuleError(body)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      if (!hasTagRules(body)) return NextResponse.json({ count: 0 })
      if (!(await tagsBelongToAccount(db, ctx.accountId, body))) {
        return NextResponse.json({ error: "A chosen tag no longer exists. Choose the tags again." }, { status: 400 })
      }
      const count = await db.contact.count({ where: { AND: [sendable, tagAudienceWhere(body)] } })
      return NextResponse.json({ count })
    }

    let excludeIds: string[] = []
    if (Array.isArray(body.excludeTagIds) && body.excludeTagIds.length > 0) {
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

    if (body.type === "engagement") {
      const kind = body.engagement?.kind
      const days = engagementDays(body.engagement?.days)
      if (!isEngagementKind(kind) || !days) return NextResponse.json({ count: 0 })
      const count = await db.contact.count({ where: { AND: [sendable, engagementWhere(ctx.accountId, kind, days), notExcluded] } })
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
