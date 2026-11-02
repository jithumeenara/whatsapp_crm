import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { audit, auditCtx } from "@/lib/audit"

/**
 * POST /api/contacts/[id]/restore
 * Brings an archived contact back, with everything it had.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const { id } = await params
    const restored = await prisma.contact.updateMany({
      where: { id, account_id: ctx.accountId },
      data: { archived_at: null, archived_by: null },
    })
    if (restored.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await audit(auditCtx(req, ctx), { action: "record.restored", target: { type: "contact", id, label: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
