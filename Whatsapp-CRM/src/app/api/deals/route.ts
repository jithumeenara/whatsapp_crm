import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/deals
 * Creates a new deal for the current account.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const {
      title,
      value,
      currency,
      contact_id,
      pipeline_id,
      stage_id,
      assigned_to,
      notes,
      expected_close_date,
    } = body as Record<string, unknown>

    if (!title || !contact_id || !stage_id || !pipeline_id) {
      return NextResponse.json(
        { error: "title, contact_id, pipeline_id, and stage_id are required" },
        { status: 400 },
      )
    }

    // Verify pipeline belongs to this account
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: String(pipeline_id), account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    }

    const deal = await prisma.deal.create({
      data: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        title: String(title),
        value: value !== undefined ? Number(value) || 0 : 0,
        currency: currency ? String(currency) : null,
        contact_id: String(contact_id),
        pipeline_id: String(pipeline_id),
        stage_id: String(stage_id),
        assigned_to: assigned_to ? String(assigned_to) : null,
        notes: notes ? String(notes) : null,
        expected_close_date: expected_close_date ? String(expected_close_date) : null,
        status: "open",
      },
    })

    return NextResponse.json({ deal }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
