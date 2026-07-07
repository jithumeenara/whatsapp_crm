import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer")
    const integrations = await prisma.integration.findMany({
      where: { account_id: ctx.accountId },
      include: { syncs: { orderBy: { started_at: "desc" }, take: 1 } },
      orderBy: { created_at: "desc" },
    })
    return NextResponse.json({ integrations })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "admin")
    const body = await req.json() as {
      name: string
      category?: string
      source_type?: string
      base_url: string
      resource: string
      auth_type?: string
      auth_config?: unknown
      table_name?: string
      sync_interval_minutes?: number | null
    }

    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })
    if (!body.base_url?.trim()) return NextResponse.json({ error: "base_url is required" }, { status: 400 })
    if (!body.resource?.trim()) return NextResponse.json({ error: "resource is required" }, { status: 400 })

    const integration = await prisma.integration.create({
      data: {
        account_id: ctx.accountId,
        name: body.name.trim(),
        category: body.category ?? "custom",
        source_type: body.source_type ?? "rest",
        base_url: body.base_url.trim(),
        resource: body.resource.trim(),
        auth_type: body.auth_type ?? "none",
        auth_config: body.auth_config ?? undefined,
        table_name: body.table_name?.trim() || null,
        sync_interval_minutes: body.sync_interval_minutes ?? null,
        status: "active",
      },
    })

    return NextResponse.json({ integration }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
