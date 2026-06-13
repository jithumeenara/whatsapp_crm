import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

/**
 * GET /api/custom-fields
 * Returns all custom field definitions for the current account.
 */
export async function GET() {
  try {
    const ctx = await requireRole("viewer")
    const fields = await prisma.customField.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { field_name: "asc" },
    })
    return NextResponse.json({ fields })
  } catch (err) {
    return toErrorResponse(err)
  }
}
