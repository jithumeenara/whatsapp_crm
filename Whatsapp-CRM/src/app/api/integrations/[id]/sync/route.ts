import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { runSync } from "@/lib/integration-sync"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")
    const { id } = await params

    const integration = await prisma.integration.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!integration) return NextResponse.json({ error: "Integration not found" }, { status: 404 })
    if (integration.status === "paused") {
      return NextResponse.json({ error: "Integration is paused" }, { status: 400 })
    }

    // Create a sync log row (running)
    const syncLog = await prisma.integrationSync.create({
      data: { integration_id: id, status: "running" },
    })

    try {
      const result = await runSync(prisma, integration, ctx.userId)

      await prisma.integrationSync.update({
        where: { id: syncLog.id },
        data: {
          status: "success",
          records_synced: result.records_synced,
          contacts_created: result.contacts_created,
          completed_at: new Date(),
        },
      })

      await prisma.integration.update({
        where: { id },
        data: { last_synced_at: new Date(), status: "active" },
      })

      return NextResponse.json({ success: true, ...result })
    } catch (syncErr) {
      const msg = syncErr instanceof Error ? syncErr.message : String(syncErr)
      await prisma.integrationSync.update({
        where: { id: syncLog.id },
        data: { status: "error", error_message: msg, completed_at: new Date() },
      })
      await prisma.integration.update({
        where: { id },
        data: { status: "error" },
      })
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
