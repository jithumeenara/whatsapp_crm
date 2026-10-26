import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account"
import { loadTableRule, tableColumnValues, tableRuleError } from "@/lib/broadcasts/table-audience"

/**
 * GET /api/broadcasts/table-values?tableId=…&fieldKey=…
 * The values a column holds, for the broadcast "From a table" picker —
 * only for columns of a few repeated values (a status, a batch); others
 * return none and the person types the value.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    assertPageAccess(ctx, "/broadcasts")
    const tableId = req.nextUrl.searchParams.get("tableId") ?? ""
    const fieldKey = req.nextUrl.searchParams.get("fieldKey") ?? ""
    const problem = tableRuleError({ tableId, fieldKey, operator: "is_not_empty" })
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const loaded = await loadTableRule(ctx.accountId, { tableId, fieldKey })
    if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 404 })
    const values = await tableColumnValues(ctx.accountId, tableId, fieldKey)
    return NextResponse.json({ values })
  } catch (err) {
    return toErrorResponse(err)
  }
}
