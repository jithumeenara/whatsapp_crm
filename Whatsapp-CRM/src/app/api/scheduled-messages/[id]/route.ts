import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * PATCH /api/scheduled-messages/[id]
 * Body: { status: 'active' | 'paused' | 'cancelled' } -- the only edits
 * allowed after creation are pausing/resuming/cancelling. Editing content
 * or schedule requires cancelling and creating a new one.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params
    const body = await req.json().catch(() => null)
    const status = body?.status
    if (!["active", "paused", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "status must be active, paused, or cancelled" }, { status: 400 })
    }

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (existing.status === "completed" || existing.status === "cancelled") {
      return NextResponse.json({ error: "This scheduled message has already ended" }, { status: 400 })
    }

    const updated = await prisma.scheduledMessage.update({
      where: { id },
      data: { status },
    })
    return NextResponse.json({ item: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/scheduled-messages/[id]
 * Hard-cancels (soft-delete via status, not a row delete, so it stays
 * visible in the conversation's schedule history).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.scheduledMessage.update({ where: { id }, data: { status: "cancelled" } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
