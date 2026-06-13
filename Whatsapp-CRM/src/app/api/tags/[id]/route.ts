import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params
    // Verify ownership — tag must belong to the caller's account
    const tag = await prisma.tag.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }
    await prisma.tag.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
