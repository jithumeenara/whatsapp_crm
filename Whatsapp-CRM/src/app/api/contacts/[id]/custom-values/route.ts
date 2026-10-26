import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/contacts/[id]/custom-values
 * Returns custom field definitions + values for a contact.
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

    const [fields, values] = await Promise.all([
      prisma.customField.findMany({
        where: { account_id: ctx.accountId },
        orderBy: { field_name: "asc" },
      }),
      prisma.contactCustomValue.findMany({ where: { contact_id: id } }),
    ])

    return NextResponse.json({ fields, values })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/contacts/[id]/custom-values
 * Saves the custom values sent; fields not sent keep theirs.
 * Body: { values: Record<fieldId, string> }
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
    const values = body?.values
    // A missing or unreadable body used to mean "no values" and wiped
    // every value this contact had.
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      return NextResponse.json({ error: "Nothing to save." }, { status: 400 })
    }

    // Only this account's fields, and only the ones sent: a field left
    // out keeps its value; one sent empty is cleared.
    const fieldIds = Object.keys(values).slice(0, 200)
    const fields = await prisma.customField.findMany({
      where: { id: { in: fieldIds }, account_id: ctx.accountId },
      select: { id: true },
    })
    const allowed = new Set(fields.map((f) => f.id))

    const clear: string[] = []
    const set: Array<{ fieldId: string; value: string }> = []
    for (const fieldId of fieldIds) {
      if (!allowed.has(fieldId)) continue
      const raw = (values as Record<string, unknown>)[fieldId]
      const value = typeof raw === "string" ? raw.trim().slice(0, 5000) : ""
      if (value) set.push({ fieldId, value })
      else clear.push(fieldId)
    }

    await prisma.$transaction([
      ...(clear.length
        ? [prisma.contactCustomValue.deleteMany({ where: { contact_id: id, custom_field_id: { in: clear } } })]
        : []),
      ...set.map(({ fieldId, value }) =>
        prisma.contactCustomValue.upsert({
          where: { contact_id_custom_field_id: { contact_id: id, custom_field_id: fieldId } },
          create: { contact_id: id, custom_field_id: fieldId, value },
          update: { value },
        }),
      ),
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
