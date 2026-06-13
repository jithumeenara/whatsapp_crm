import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * POST /api/broadcasts/draft
 *
 * Saves a broadcast as a draft (status = 'draft', 0 recipients, 0 counts).
 * Body: { name, template_name, template_language, template_variables, audience_filter }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const { name, template_name, template_language, template_variables, audience_filter } =
      body as Record<string, unknown>

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    if (!template_name || typeof template_name !== "string") {
      return NextResponse.json({ error: "template_name is required" }, { status: 400 })
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: name.trim(),
        template_name: template_name,
        template_language: (template_language as string) ?? "en_US",
        template_variables: template_variables ?? {},
        audience_filter: audience_filter ?? {},
        status: "draft",
        total_recipients: 0,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      },
    })

    return NextResponse.json({ broadcast }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
