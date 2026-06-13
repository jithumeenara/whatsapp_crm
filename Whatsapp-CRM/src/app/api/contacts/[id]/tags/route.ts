import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/contacts/[id]/tags
 * Returns all contact_tag join rows for the contact.
 * Shape: { tags: ContactTag[] }
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
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const tags = await prisma.contactTag.findMany({
      where: { contact_id: id },
    })

    return NextResponse.json({ tags })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/contacts/[id]/tags
 * Replaces the full tag set for a contact.
 * Body: { tag_ids: string[] }
 */
export async function PUT(
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
    const tagIds: string[] = Array.isArray(body?.tag_ids) ? body.tag_ids : []

    await prisma.contactTag.deleteMany({ where: { contact_id: id } })
    if (tagIds.length > 0) {
      await prisma.contactTag.createMany({
        data: tagIds.map((tag_id) => ({ contact_id: id, tag_id })),
        skipDuplicates: true,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/contacts/[id]/tags
 * Adds a single tag to a contact.
 * Body: { tag_id: string }
 */
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
    const tagId = body?.tag_id
    if (!tagId) {
      return NextResponse.json({ error: "tag_id is required" }, { status: 400 })
    }

    await prisma.contactTag.upsert({
      where: { contact_id_tag_id: { contact_id: id, tag_id: tagId } },
      create: { contact_id: id, tag_id: tagId },
      update: {},
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/contacts/[id]/tags?tag_id=...
 * Removes a tag from a contact.
 */
export async function DELETE(
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

    const tagId = new URL(req.url).searchParams.get("tag_id")
    if (!tagId) {
      return NextResponse.json({ error: "tag_id is required" }, { status: 400 })
    }

    await prisma.contactTag.deleteMany({
      where: { contact_id: id, tag_id: tagId },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
