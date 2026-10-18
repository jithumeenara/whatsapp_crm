import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { addTagsToContact, removeTagsFromContact } from "@/lib/contacts/tag-events"
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
    const tagIds: string[] = Array.isArray(body?.tag_ids)
      ? (body.tag_ids as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 200)
      : []

    // Tags no longer in the list go; the rest are added through the one
    // path that checks they are this account's and fires "Tag added" for
    // the ones that are new.
    await removeTagsFromContact({ accountId: ctx.accountId, contactId: id, keepTagIds: tagIds, source: "inbox" })
    if (tagIds.length > 0) {
      await addTagsToContact({ accountId: ctx.accountId, contactId: id, tagIds, source: "inbox" })
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

    if (typeof tagId !== "string") {
      return NextResponse.json({ error: "tag_id is required" }, { status: 400 })
    }
    const owned = await prisma.tag.findFirst({ where: { id: tagId, account_id: ctx.accountId }, select: { id: true } })
    if (!owned) {
      return NextResponse.json({ error: "That tag does not exist." }, { status: 404 })
    }
    await addTagsToContact({ accountId: ctx.accountId, contactId: id, tagIds: [tagId], source: "inbox" })

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

    await removeTagsFromContact({ accountId: ctx.accountId, contactId: id, tagIds: [tagId], source: "inbox" })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
