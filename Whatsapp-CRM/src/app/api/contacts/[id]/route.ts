import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/contacts/[id]
 * Returns a contact with its tags, notes, and deals.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const [contactTags, notes, deals] = await Promise.all([
      prisma.contactTag.findMany({
        where: { contact_id: id },
        include: { tag: true },
      }),
      prisma.contactNote.findMany({
        where: { contact_id: id },
        orderBy: { created_at: "desc" },
      }),
      prisma.deal.findMany({
        where: { contact_id: id },
        orderBy: { created_at: "desc" },
        include: {
          stage: { select: { id: true, name: true, color: true } },
        },
      }),
    ])

    const tags = contactTags.map((ct) => ({
      ...ct.tag,
      contact_tag_id: ct.id,
    }))

    return NextResponse.json({ contact, tags, notes, deals })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/contacts/[id]
 * Deletes a contact belonging to the current account.
 */
export async function DELETE(
  _req: NextRequest,
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

    await prisma.contact.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/contacts/[id]
 * Updates a contact belonging to the current account.
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

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const allowed = ["phone", "name", "email", "company", "avatar_url"] as const
    const data: Record<string, string | null> = {}
    for (const k of allowed) {
      if (k in body) data[k] = body[k] ?? null
    }

    const updated = await prisma.contact.update({ where: { id }, data })
    return NextResponse.json({ contact: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
