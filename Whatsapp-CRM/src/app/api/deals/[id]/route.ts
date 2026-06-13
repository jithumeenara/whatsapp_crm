import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * DELETE /api/deals/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const deal = await prisma.deal.findFirst({
      where: { id },
      include: { pipeline: { select: { account_id: true } } },
    })
    if (!deal || deal.pipeline.account_id !== ctx.accountId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.deal.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/deals/[id]
 * Updates a deal (move stage, edit fields, etc).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    // Verify deal belongs to this account via pipeline
    const deal = await prisma.deal.findFirst({
      where: { id },
      include: { pipeline: { select: { account_id: true } } },
    })
    if (!deal || deal.pipeline.account_id !== ctx.accountId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const allowed = [
      "stage_id",
      "title",
      "value",
      "currency",
      "notes",
      "expected_close_date",
      "status",
      "assigned_to",
      "contact_id",
    ] as const
    const data: Record<string, unknown> = {}
    for (const k of allowed) {
      if (k in body) data[k] = body[k]
    }

    const updated = await prisma.deal.update({ where: { id }, data })
    return NextResponse.json({ deal: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
