import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const ctx = await requireRole("viewer")
    const conversations = await ctx.db.conversation.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { last_message_at: "desc" },
      include: {
        contact: true,
      },
    })
    return NextResponse.json(conversations)
  } catch (err) {
    return toErrorResponse(err)
  }
}
