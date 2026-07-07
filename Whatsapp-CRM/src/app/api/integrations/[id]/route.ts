import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer")
    const { id } = await params
    const integration = await prisma.integration.findFirst({
      where: { id, account_id: ctx.accountId },
      include: { syncs: { orderBy: { started_at: "desc" }, take: 10 } },
    })
    if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ integration })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "admin")
    const { id } = await params
    const body = await req.json()

    const integration = await prisma.integration.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.integration.update({
      where: { id },
      data: {
        name: body.name ?? integration.name,
        category: body.category ?? integration.category,
        source_type: body.source_type ?? integration.source_type,
        base_url: body.base_url ?? integration.base_url,
        resource: body.resource ?? integration.resource,
        auth_type: body.auth_type ?? integration.auth_type,
        auth_config: body.auth_config !== undefined ? body.auth_config : integration.auth_config,
        table_name: body.table_name !== undefined ? (body.table_name || null) : integration.table_name,
        sync_interval_minutes: body.sync_interval_minutes !== undefined ? (body.sync_interval_minutes || null) : integration.sync_interval_minutes,
        status: body.status ?? integration.status,
      },
    })
    return NextResponse.json({ integration: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "admin")
    const { id } = await params
    const integration = await prisma.integration.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.integration.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
