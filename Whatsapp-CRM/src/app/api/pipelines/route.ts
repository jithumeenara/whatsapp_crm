import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 },
  { name: "Qualified", color: "#eab308", position: 1 },
  { name: "Proposal Sent", color: "#f97316", position: 2 },
  { name: "Negotiation", color: "#8b5cf6", position: 3 },
  { name: "Won", color: "#22c55e", position: 4 },
]

/**
 * GET /api/pipelines
 * Returns all pipelines for the current account, ordered by created_at.
 * Also returns all stages and deals for the account.
 */
export async function GET() {
  try {
    const ctx = await requireRole("viewer")

    const pipelines = await prisma.pipeline.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: "asc" },
    })

    return NextResponse.json({ pipelines })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/pipelines
 * Creates a new pipeline with the default stages.
 * Body: { name: string }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("admin")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const { name } = body as { name?: string }
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: name.trim(),
      },
    })

    await prisma.pipelineStage.createMany({
      data: SPEC_DEFAULT_STAGES.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      })),
    })

    return NextResponse.json({ pipeline }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
