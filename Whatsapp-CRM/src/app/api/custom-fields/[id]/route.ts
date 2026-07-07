import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params
    const existing = await prisma.customField.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    // ContactCustomValue has onDelete: Cascade but we delete explicitly for safety
    await prisma.$transaction([
      prisma.contactCustomValue.deleteMany({ where: { custom_field_id: id } }),
      prisma.customField.delete({ where: { id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
