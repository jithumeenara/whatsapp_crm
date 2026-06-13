import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id, noteId } = await params

    // Verify contact + note belong to this account
    const note = await prisma.contactNote.findFirst({
      where: { id: noteId, contact_id: id, account_id: ctx.accountId },
    })
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.contactNote.delete({ where: { id: noteId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
