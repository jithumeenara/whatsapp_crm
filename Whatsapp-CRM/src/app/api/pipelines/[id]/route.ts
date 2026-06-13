import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * DELETE /api/pipelines/[id]
 * Deletes a pipeline (admin only).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.pipeline.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/pipelines/[id]
 * Updates a pipeline name (admin only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.pipeline.update({
      where: { id },
      data: { name: body.name },
    })
    return NextResponse.json({ pipeline: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
