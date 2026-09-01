import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/whatsapp/encryption"

const MASKED = "••••••••••••••••"

/**
 * GET /api/platform/meta-config
 *
 * The ONE platform-wide Meta App used for Embedded Signup — not a
 * per-tenant config like /api/whatsapp/config. Owner-gated on whichever
 * account the operator manages this from (this app has no separate
 * "platform superadmin" role; in practice only the operator's own account
 * is ever used to touch this).
 */
export async function GET() {
  try {
    await requireRole("owner")
    const config = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" } })
    if (!config) return NextResponse.json({ configured: false })

    return NextResponse.json({
      configured: true,
      app_id: config.app_id,
      config_id: config.config_id,
      app_secret: MASKED,
      updated_at: config.updated_at,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/platform/meta-config — body: { app_id, app_secret, config_id } */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")
    const body = await req.json().catch(() => ({}))
    const { app_id, app_secret, config_id } = body as { app_id?: string; app_secret?: string; config_id?: string }

    if (!app_id?.trim() || !config_id?.trim()) {
      return NextResponse.json({ error: "App ID and Configuration ID are required" }, { status: 400 })
    }

    const existing = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" } })
    const keepSecret = !app_secret || app_secret === MASKED
    if (keepSecret && !existing) {
      return NextResponse.json({ error: "App Secret is required" }, { status: 400 })
    }
    const secretToSave = keepSecret ? existing!.app_secret : encrypt(app_secret!.trim())

    await prisma.metaPlatformConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", app_id: app_id.trim(), app_secret: secretToSave, config_id: config_id.trim(), updated_by: ctx.userId },
      update: { app_id: app_id.trim(), app_secret: secretToSave, config_id: config_id.trim(), updated_by: ctx.userId },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
