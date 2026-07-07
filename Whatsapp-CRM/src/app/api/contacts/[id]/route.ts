import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { normalizePhone } from "@/lib/whatsapp/phone-utils"

/**
 * GET /api/contacts/[id]
 * Returns a contact with its tags and notes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer")
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const [contactTags, notes] = await Promise.all([
      prisma.contactTag.findMany({
        where: { contact_id: id },
        include: { tag: true },
      }),
      prisma.contactNote.findMany({
        where: { contact_id: id },
        orderBy: { created_at: "desc" },
      }),
    ])

    const tags = contactTags.map((ct) => ({
      ...ct.tag,
      contact_tag_id: ct.id,
    }))

    return NextResponse.json({ contact, tags, notes })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/contacts/[id]
 * Deletes a contact belonging to the current account.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const { id } = await params

    const contact = await prisma.contact.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      // FlowRun.last_prompt_message_id is a nullable FK to Message with
      // onDelete:SetNull, but the database-level cascade order can race:
      // contact→conversation→message cascade deletes messages before
      // PostgreSQL has a chance to null the FK on flow_runs, causing a
      // constraint violation. Explicitly null + delete flow_runs first.
      await tx.flowRun.updateMany({
        where: { contact_id: id },
        data: { last_prompt_message_id: null },
      })
      await tx.flowRun.deleteMany({ where: { contact_id: id } })

      await tx.broadcastRecipient.deleteMany({ where: { contact_id: id } })
      await tx.deal.deleteMany({ where: { contact_id: id } })
      await tx.task.deleteMany({ where: { contact_id: id } })
      await tx.followUp.deleteMany({ where: { contact_id: id } })
      await tx.contact.delete({ where: { id } })
    })
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
    const ctx = await requireRoleOrApiKey(req, "agent")
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

    const allowed = ["phone", "name", "email", "company", "avatar_url", "alternate_phone", "gender"] as const
    const data: Record<string, string | null> = {}
    for (const k of allowed) {
      if (k in body) data[k] = body[k] ?? null
    }
    // Keep phone_normalized in sync so the unique index stays valid
    if ("phone" in data && data.phone) {
      data.phone_normalized = normalizePhone(data.phone)
    }

    const updated = await prisma.contact.update({ where: { id }, data })
    return NextResponse.json({ contact: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
