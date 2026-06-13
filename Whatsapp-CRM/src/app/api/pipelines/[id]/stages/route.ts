import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * POST /api/pipelines/[id]/stages
 * Creates a new stage in the pipeline.
 * Body: { name, color, position }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const { name, color, position } = (body ?? {}) as Record<string, unknown>
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    const stage = await prisma.pipelineStage.create({
      data: {
        pipeline_id: id,
        name: String(name),
        color: color ? String(color) : "#3b82f6",
        position: typeof position === "number" ? position : 0,
      },
    })
    return NextResponse.json({ stage }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/pipelines/[id]/stages
 * Bulk-upsert stages (for pipeline settings save).
 * Body: { stages: Array<{id, name, color, position}> }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params

    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const stages: Array<{ id: string; name: string; color: string; position: number }> =
      body?.stages ?? []

    await Promise.all(
      stages.map((s) =>
        prisma.pipelineStage.update({
          where: { id: s.id },
          data: { name: s.name, color: s.color, position: s.position },
        }),
      ),
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * GET /api/pipelines/[id]/stages
 * Returns all stages for a pipeline, ordered by position.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    // Verify pipeline belongs to this account
    const pipeline = await prisma.pipeline.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!pipeline) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const stages = await prisma.pipelineStage.findMany({
      where: { pipeline_id: id },
      orderBy: { position: "asc" },
    })

    return NextResponse.json({ stages })
  } catch (err) {
    return toErrorResponse(err)
  }
}
