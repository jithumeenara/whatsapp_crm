import { NextRequest, NextResponse } from "next/server"
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"

interface AudienceCountBody {
  type: string
  tagIds?: string[]
  customField?: {
    fieldId: string
    operator: "is" | "is_not" | "contains"
    value: string
  }
  csvContacts?: { phone: string }[]
  excludeTagIds?: string[]
}

/**
 * POST /api/broadcasts/audience-count
 * Returns an estimated recipient count for the given audience config.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const db = ctx.db
    const body = (await req.json()) as AudienceCountBody

    if (body.type === "csv") {
      return NextResponse.json({ count: body.csvContacts?.length ?? 0 })
    }

    let baseIds: Set<string> | null = null

    if (body.type === "all") {
      // null means "all" — handled after exclude
    } else if (body.type === "tags" && body.tagIds && body.tagIds.length > 0) {
      const rows = await db.contactTag.findMany({
        where: { tag_id: { in: body.tagIds } },
        select: { contact_id: true },
      })
      baseIds = new Set(rows.map((r) => r.contact_id))
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
      baseIds = new Set(rows.map((r) => r.contact_id))
    } else {
      return NextResponse.json({ count: null })
    }

    let excludeSet: Set<string> | null = null
    if (body.excludeTagIds && body.excludeTagIds.length > 0) {
      const rows = await db.contactTag.findMany({
        where: { tag_id: { in: body.excludeTagIds } },
        select: { contact_id: true },
      })
      excludeSet = new Set(rows.map((r) => r.contact_id))
    }

    if (baseIds) {
      const effective = excludeSet
        ? [...baseIds].filter((id) => !excludeSet!.has(id)).length
        : baseIds.size
      return NextResponse.json({ count: effective })
    }

    const total = await db.contact.count({ where: { account_id: ctx.accountId } })
    const count = excludeSet ? Math.max(0, total - excludeSet.size) : total
    return NextResponse.json({ count })
  } catch (err) {
    return toErrorResponse(err)
  }
}
