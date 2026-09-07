import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"
import { fetchCatalogProducts } from "@/lib/whatsapp/catalog-api"

/**
 * GET /api/catalog/config
 * Mirrors /api/meta-ads/config's shape: 200 for every non-auth outcome so
 * the Catalog settings tab can render inline state instead of toast-only
 * errors.
 */
export async function GET() {
  try {
    const ctx = await requireRole("agent")

    const config = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })
    if (!config) {
      return NextResponse.json({ connected: false, reason: "no_config", message: "No catalog connected yet." })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({
        connected: false,
        reason: "token_corrupted",
        needs_reset: true,
        message: "The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Reset and re-connect.",
      })
    }

    const productCount = await prisma.product.count({ where: { account_id: ctx.accountId } })

    const safeConfig = {
      id: config.id,
      catalog_id: config.catalog_id,
      business_id: config.business_id,
      default_pipeline_id: config.default_pipeline_id,
      default_stage_id: config.default_stage_id,
      status: config.status,
      last_synced_at: config.last_synced_at,
      last_tested_at: config.last_tested_at,
      test_error: config.test_error,
      connected_at: config.connected_at,
      product_count: productCount,
    }

    // Cheap liveness check — a 1-row product fetch, not a full sync.
    let ok = true
    let message = "Connected."
    try {
      await fetchCatalogProducts({ catalogId: config.catalog_id, accessToken })
    } catch (err) {
      ok = false
      message = err instanceof Error ? err.message : "Meta rejected the stored credentials."
    }

    return NextResponse.json({ connected: ok, config: safeConfig, message })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT /api/catalog/config — Manual Connect, or updating the default pipeline/stage. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("owner")

    const body = await request.json()
    const { catalog_id, business_id, access_token, default_pipeline_id, default_stage_id } = body as {
      catalog_id?: string
      business_id?: string
      access_token?: string
      default_pipeline_id?: string | null
      default_stage_id?: string | null
    }

    const existing = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })

    // access_token is only required the first time, or when explicitly
    // rotating it — lets the settings UI save just the default
    // pipeline/stage without asking the owner to re-paste a token.
    const tokenToUse = access_token || (existing ? decrypt(existing.access_token) : null)
    if (!catalog_id || !tokenToUse) {
      return NextResponse.json({ error: "Catalog ID and Access Token are required." }, { status: 400 })
    }

    let testError: string | null = null
    try {
      await fetchCatalogProducts({ catalogId: catalog_id, accessToken: tokenToUse })
    } catch (err) {
      testError = err instanceof Error ? err.message : "Meta rejected these credentials."
      return NextResponse.json({ error: `Meta rejected these credentials: ${testError}` }, { status: 400 })
    }

    const now = new Date()
    const data = {
      catalog_id,
      business_id: business_id || existing?.business_id || null,
      access_token: encrypt(tokenToUse),
      default_pipeline_id: default_pipeline_id === undefined ? existing?.default_pipeline_id ?? null : default_pipeline_id,
      default_stage_id: default_stage_id === undefined ? existing?.default_stage_id ?? null : default_stage_id,
      status: "connected",
      last_tested_at: now,
      test_error: testError,
      connected_at: existing?.connected_at ?? now,
    }

    if (existing) {
      await prisma.catalogConfig.update({ where: { account_id: ctx.accountId }, data })
    } else {
      await prisma.catalogConfig.create({ data: { account_id: ctx.accountId, user_id: ctx.userId, ...data } })
    }

    return NextResponse.json({ success: true, saved: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/catalog/config — disconnect. Local Product/Order rows are kept (historical record), only the connection is removed. */
export async function DELETE() {
  try {
    const ctx = await requireRole("owner")
    try {
      await prisma.catalogConfig.delete({ where: { account_id: ctx.accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ success: true })
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
