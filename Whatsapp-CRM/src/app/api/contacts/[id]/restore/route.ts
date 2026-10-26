import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

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
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
