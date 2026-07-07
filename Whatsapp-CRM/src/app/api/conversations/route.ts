import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

async function ensureChannelColumn() {
  await prisma.$executeRaw`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
  `.catch(() => {})
}

export async function GET() {
  try {
    const ctx = await requireRole("viewer")
    await ensureChannelColumn()

    // Agents can only see conversations explicitly assigned to them
    // (by an admin or by a chatbot handoff). Admins/owners see everything.
    const where = {
      account_id: ctx.accountId,
      ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
    }

    const conversations = await ctx.db.conversation.findMany({
      where,
      orderBy: { last_message_at: "desc" },
      include: {
        contact: true,
        assigned_agent: {
          select: {
            id: true,
            email: true,
            profile: { select: { full_name: true } },
          },
        },
      },
    })
    return NextResponse.json(conversations)
  } catch (err) {
    return toErrorResponse(err)
  }
}
