import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/whatsapp/templates
 * Returns message templates for the current account.
 * Query params:
 *   status — filter by status (e.g. "APPROVED")
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")

    const templates = await prisma.messageTemplate.findMany({
      where: {
        account_id: ctx.accountId,
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: "desc" },
    })

    return NextResponse.json({ templates })
  } catch (err) {
    return toErrorResponse(err)
  }
}
