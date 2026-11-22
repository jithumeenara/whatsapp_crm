import { NextRequest, NextResponse } from "next/server"
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account"
import { isPlatformOwner } from "@/lib/auth/platform-owner"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/whatsapp/encryption"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { CONNECT_CALLBACK_PATH, connectOrigin } from "@/lib/meta/social-connect-server"

const MASKED = "••••••••••••••••"

/**
 * The server owner only (lib/auth/platform-owner.ts), not the owner of
 * whichever workspace is asking. This one Meta App receives the WhatsApp
 * Business tokens of every tenant who connects through Embedded Signup,
 * so a tenant owner — anybody, on a server with open sign-ups — who could
 * replace it would collect every other tenant's tokens from then on.
 */
async function requirePlatformOwner() {
  const ctx = await requireRole("owner")
  if (!(await isPlatformOwner(ctx.userId))) {
    throw new ForbiddenError("Only the server owner can change the platform Meta App.")
  }
  return ctx
}

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
    await requirePlatformOwner()
    const config = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" } })
    // The exact addresses to paste in the Meta dashboard, from this server's
    // own setting (www vs no www matters: Meta matches them letter by letter).
    const origin = connectOrigin()
    const addresses = {
      redirect_uri: origin ? `${origin}${CONNECT_CALLBACK_PATH}` : null,
      instagram_webhook: origin ? `${origin}/api/instagram/webhook` : null,
      messenger_webhook: origin ? `${origin}/api/facebook/webhook` : null,
    }
    if (!config) return NextResponse.json({ configured: false, ...addresses })

    return NextResponse.json({
      configured: true,
      app_id: config.app_id,
      config_id: config.config_id,
      instagram_config_id: config.instagram_config_id ?? "",
      messenger_config_id: config.messenger_config_id ?? "",
      ads_config_id: config.ads_config_id ?? "",
      catalog_config_id: config.catalog_config_id ?? "",
      app_secret: MASKED,
      // Whether a webhook verify token is saved — never the token itself.
      has_verify_token: Boolean(config.webhook_verify_token),
      updated_at: config.updated_at,
      ...addresses,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** A Facebook Login for Business configuration id: digits, or "" to clear. undefined = not sent. */
function configIdField(v: unknown): string | undefined | null {
  if (v === undefined) return undefined
  if (typeof v !== "string") return null
  const t = v.trim()
  return t === "" || /^\d{5,30}$/.test(t) ? t : null
}

/**
 * PATCH /api/platform/meta-config — body: { app_id, app_secret, config_id,
 * instagram_config_id, messenger_config_id }. Each configuration is
 * optional (WhatsApp Embedded Signup, Connect Instagram, Connect
 * Messenger); at least one is needed.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requirePlatformOwner()
    const body = await req.json().catch(() => ({}))
    const { app_id, app_secret, config_id } = body as { app_id?: unknown; app_secret?: unknown; config_id?: unknown }
    const appId = typeof app_id === "string" ? app_id.trim() : ""
    if (!appId || appId.length > 64) return NextResponse.json({ error: "App ID is required" }, { status: 400 })
    const waConfig = typeof config_id === "string" ? config_id.trim() : ""
    if (waConfig.length > 64) return NextResponse.json({ error: "The WhatsApp configuration ID is too long." }, { status: 400 })
    if (app_secret !== undefined && (typeof app_secret !== "string" || app_secret.length > 256)) {
      return NextResponse.json({ error: "The App Secret is not valid." }, { status: 400 })
    }

    // Old screens sent one shared social_config_id for both.
    const legacy = configIdField((body as { social_config_id?: unknown }).social_config_id)
    let igConfig = configIdField((body as { instagram_config_id?: unknown }).instagram_config_id)
    let fbConfig = configIdField((body as { messenger_config_id?: unknown }).messenger_config_id)
    if (igConfig === undefined && fbConfig === undefined && legacy !== undefined) { igConfig = legacy; fbConfig = legacy }
    const adsConfig = configIdField((body as { ads_config_id?: unknown }).ads_config_id)
    const catConfig = configIdField((body as { catalog_config_id?: unknown }).catalog_config_id)
    if (igConfig === null || fbConfig === null || adsConfig === null || catConfig === null) {
      return NextResponse.json({ error: "A Messenger or Instagram configuration ID is a number from the App Dashboard." }, { status: 400 })
    }

    const existing = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" } })
    const keepSecret = !app_secret || app_secret === MASKED
    if (keepSecret && !existing) {
      return NextResponse.json({ error: "App Secret is required" }, { status: 400 })
    }
    const secretToSave = keepSecret ? existing!.app_secret : encrypt((app_secret as string).trim())

    const nextIg = igConfig !== undefined ? igConfig : (existing?.instagram_config_id ?? "")
    const nextFb = fbConfig !== undefined ? fbConfig : (existing?.messenger_config_id ?? "")
    const nextAds = adsConfig !== undefined ? adsConfig : (existing?.ads_config_id ?? "")
    const nextCat = catConfig !== undefined ? catConfig : (existing?.catalog_config_id ?? "")
    if (!waConfig && !nextIg && !nextFb && !nextAds && !nextCat) {
      return NextResponse.json({ error: "Add at least one configuration ID (WhatsApp, Instagram or Messenger)." }, { status: 400 })
    }

    const channelConfigs = {
      ...(igConfig !== undefined ? { instagram_config_id: igConfig || null } : {}),
      ...(fbConfig !== undefined ? { messenger_config_id: fbConfig || null } : {}),
      ...(adsConfig !== undefined ? { ads_config_id: adsConfig || null } : {}),
      ...(catConfig !== undefined ? { catalog_config_id: catConfig || null } : {}),
      // The old shared value is replaced by the two fields above (migration 179).
      ...(igConfig !== undefined || fbConfig !== undefined ? { social_config_id: null } : {}),
    }
    await prisma.metaPlatformConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", app_id: appId, app_secret: secretToSave, config_id: waConfig, ...channelConfigs, updated_by: ctx.userId },
      update: { app_id: appId, app_secret: secretToSave, config_id: waConfig, ...channelConfigs, updated_by: ctx.userId },
    })

    // Which fields changed — never the App Secret or any value.
    const fields = [
      ...(existing?.app_id !== appId ? ["app_id"] : []),
      ...(existing?.config_id !== waConfig ? ["config_id"] : []),
      ...(igConfig !== undefined && (existing?.instagram_config_id ?? "") !== igConfig ? ["instagram_config_id"] : []),
      ...(fbConfig !== undefined && (existing?.messenger_config_id ?? "") !== fbConfig ? ["messenger_config_id"] : []),
      ...(adsConfig !== undefined && (existing?.ads_config_id ?? "") !== adsConfig ? ["ads_config_id"] : []),
      ...(catConfig !== undefined && (existing?.catalog_config_id ?? "") !== catConfig ? ["catalog_config_id"] : []),
      ...(!keepSecret ? ["app_secret"] : []),
    ]
    await auditConfigChange(auditCtx(req, ctx), "config.platform_changed", {
      area: "platform_meta_app",
      fields,
      target: { type: "config", id: "platform_meta_app" },
      meta: { created: !existing },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
