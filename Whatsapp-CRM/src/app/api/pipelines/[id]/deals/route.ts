import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/pipelines/[id]/deals
 * Returns all deals for a pipeline, including contact and assignee joins.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const deals = await prisma.deal.findMany({
      where: { pipeline_id: id },
      orderBy: { created_at: "desc" },
      include: {
        contact: true,
        assignee: true,
      },
    })

    return NextResponse.json({ deals })
  } catch (err) {
    return toErrorResponse(err)
  }
}
