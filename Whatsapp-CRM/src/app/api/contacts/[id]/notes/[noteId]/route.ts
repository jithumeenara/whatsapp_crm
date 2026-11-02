import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { audit, auditCtx } from "@/lib/audit"

export async function DELETE(
  req: NextRequest,
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
    await audit(auditCtx(req, ctx), {
      action: "record.deleted",
      target: { type: "contact_note", id: noteId, label: null },
      meta: { contact_id: id, author_id: note.user_id, note_chars: note.note_text?.length ?? 0 },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
