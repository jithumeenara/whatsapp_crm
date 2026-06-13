import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/automations/[id]/logs
 *
 * Returns the automation row plus up to 100 execution logs (with contact
 * join) for the authenticated account.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const [automation, logs] = await Promise.all([
      prisma.automation.findFirst({
        where: { id, account_id: ctx.accountId },
      }),
      prisma.automationLog.findMany({
        where: { automation_id: id },
        orderBy: { created_at: "desc" },
        take: 100,
        include: {
          contact: {
            select: { id: true, name: true, phone: true },
          },
        },
      }),
    ])

    if (!automation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ automation, logs })
  } catch (err) {
    return toErrorResponse(err)
  }
}
