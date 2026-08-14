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
      include: {
        user: {
          select: {
            email: true,
            profile: { select: { full_name: true, account_role: true } },
          },
        },
      },
    })

    const shaped = notes.map(({ user, ...note }) => ({
      ...note,
      created_by_name: user.profile?.full_name || user.email,
      created_by_role: user.profile?.account_role ?? null,
    }))

    return NextResponse.json({ notes: shaped })
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

    const created = await prisma.contactNote.create({
      data: {
        contact_id: id,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: noteText,
      },
      include: {
        user: {
          select: {
            email: true,
            profile: { select: { full_name: true, account_role: true } },
          },
        },
      },
    })
    const { user, ...noteRow } = created
    const note = {
      ...noteRow,
      created_by_name: user.profile?.full_name || user.email,
      created_by_role: user.profile?.account_role ?? null,
    }

    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
