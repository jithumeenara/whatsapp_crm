import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * DELETE /api/pipelines/[id]/stages/[stageId]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id, stageId } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    }

    // Check no deals reference this stage
    const dealCount = await prisma.deal.count({ where: { stage_id: stageId } })
    if (dealCount > 0) {
      return NextResponse.json(
        { error: "Move or delete deals in this stage first" },
        { status: 409 },
      )
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
