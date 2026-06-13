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
 * Replaces all custom values for a contact.
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
    const values: Record<string, string> = body?.values ?? {}

    await prisma.contactCustomValue.deleteMany({ where: { contact_id: id } })

    const rows = Object.entries(values)
      .filter(([, val]) => val.trim())
      .map(([fieldId, val]) => ({
        contact_id: id,
        custom_field_id: fieldId,
        value: val.trim(),
      }))

    if (rows.length > 0) {
      await prisma.contactCustomValue.createMany({ data: rows })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
