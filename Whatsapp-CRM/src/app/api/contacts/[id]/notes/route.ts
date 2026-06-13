import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const notes = await prisma.contactNote.findMany({
      where: { contact_id: id },
      orderBy: { created_at: "desc" },
    })

    return NextResponse.json({ notes })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const noteText = body?.note_text?.trim()
    if (!noteText) {
      return NextResponse.json({ error: "note_text is required" }, { status: 400 })
    }

    const note = await prisma.contactNote.create({
      data: {
        contact_id: id,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: noteText,
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
