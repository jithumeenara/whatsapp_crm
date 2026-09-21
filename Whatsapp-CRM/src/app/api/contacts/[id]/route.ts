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
        // Notes previously showed only text + timestamp — no way to tell
        // which agent/admin/supervisor actually wrote it. Join through to
        // the creator's display name + account role (User has no name
        // field itself; Profile.full_name is the real display name).
        include: {
          user: {
            select: {
              email: true,
              profile: { select: { full_name: true, account_role: true } },
            },
          },
        },
      }),
    ])

    const tags = contactTags.map((ct) => ({
      ...ct.tag,
      contact_tag_id: ct.id,
    }))

    const shapedNotes = notes.map(({ user, ...note }) => ({
      ...note,
      created_by_name: user.profile?.full_name || user.email,
      created_by_role: user.profile?.account_role ?? null,
    }))

    return NextResponse.json({ contact, tags, notes: shapedNotes })
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
      // ── Hold the contact still while it is taken apart ────────────
      //
      // The ownership check above runs outside the transaction, and the
      // lead collection below runs inside it — leaving a window where a
      // message arriving on the webhook can create a lead after the
      // list has been taken but before the contact is deleted. That
      // lead would survive with a null contact: an orphan, which is the
      // exact thing the explicit lead cleanup here exists to prevent.
      //
      // FOR UPDATE closes it. Inserting a row that references a contact
      // takes FOR KEY SHARE on that contact, and FOR UPDATE conflicts
      // with it — so a concurrent lead insert waits until this
      // transaction ends, by which point the contact is gone and the
      // insert fails on its own foreign key rather than succeeding into
      // nothing.
      //
      // It also re-checks account_id inside the transaction, so the
      // authorisation and the deletion are no longer two separate
      // moments.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM contacts
        WHERE id = ${id}::uuid AND account_id = ${ctx.accountId}::uuid
        FOR UPDATE
      `
      if (locked.length === 0) return

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

      // ── The leads go too ─────────────────────────────────────────
      //
      // They did not, until now. Lead.contact_id is SetNull, so
      // deleting somebody left their enquiries behind with no contact
      // attached: rows that still counted in every total on the Leads
      // page and in the funnel, that an agent could open and be told to
      // call somebody whose number had been erased, and that no search
      // for that person would ever find again.
      //
      // An orphan is worse than either keeping the lead or removing it,
      // because it is the only one of the three that nobody can act on
      // and nobody can see is broken. Somebody deleting a contact means
      // "remove this person from my CRM", and a lead is part of that
      // person.
      //
      // Activities hang off leads with SetNull as well, so they are
      // removed explicitly for the same reason — a timeline entry
      // pointing at a lead that no longer exists is unreadable by
      // definition.
      const leadIds = (
        await tx.lead.findMany({ where: { contact_id: id }, select: { id: true } })
      ).map((l) => l.id)

      if (leadIds.length > 0) {
        await tx.leadActivity.deleteMany({ where: { lead_id: { in: leadIds } } })
        await tx.followUp.deleteMany({ where: { lead_id: { in: leadIds } } })
        await tx.task.deleteMany({ where: { lead_id: { in: leadIds } } })
        await tx.lead.deleteMany({ where: { id: { in: leadIds } } })
      }
      await tx.leadActivity.deleteMany({ where: { contact_id: id } })

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

    const allowed = ["phone", "name", "email", "company", "avatar_url", "alternate_phone", "gender", "opt_in_status"] as const
    const data: Record<string, string | null> = {}
    for (const k of allowed) {
      if (k in body) data[k] = body[k] ?? null
    }
    // Keep phone_normalized in sync so the unique index stays valid
    if ("phone" in data && data.phone) {
      data.phone_normalized = normalizePhone(data.phone)
    }
    // Matches the contacts_opt_in_status_check CHECK constraint — reject
    // early with a clear error instead of a raw DB constraint violation.
    if (data.opt_in_status && !["unknown", "opted_in", "opted_out"].includes(data.opt_in_status)) {
      return NextResponse.json({ error: "Invalid opt_in_status" }, { status: 400 })
    }

    const updated = await prisma.contact.update({ where: { id }, data })
    return NextResponse.json({ contact: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
