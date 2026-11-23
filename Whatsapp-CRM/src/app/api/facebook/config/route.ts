import { randomUUID } from 'node:crypto'
import { identifyPageToken } from "@/lib/meta/identify"
import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { cleanConfigFields } from "@/lib/meta/config-fields"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { prisma } from "@/lib/db"
import { openStoredSecret, sealSecret } from "@/lib/whatsapp/encryption"
import { ensureFacebookConfigTable as ensureTable } from "@/lib/social/ensure-tables"

const MASKED = "••••••••••••••••"

type RawRow = {
  id: string
  account_id: string
  access_token: string | null
  verify_token: string | null
  page_id: string | null
  app_secret: string | null
  status: string
  page_name: string | null
  last_tested_at: Date | null
  test_error: string | null
  connected_via?: string | null
}

export async function GET() {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT * FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    if (!row) return NextResponse.json({ configured: false })
    return NextResponse.json({
      configured: true,
      status: row.status,
      page_id: row.page_id ?? "",
      verify_token: row.verify_token ?? "",
      access_token: row.access_token ? MASKED : "",
      app_secret: row.app_secret ? MASKED : "",
      page_name: row.page_name,
      last_tested_at: row.last_tested_at,
      test_error: row.test_error,
      connected_via: row.connected_via ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    await ensureTable()

    const { action } = body as { action?: string }

    if (action === "test") {
      const rows = await prisma.$queryRaw<RawRow[]>`
        SELECT * FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
      `
      const token = openStoredSecret(rows[0]?.access_token)
      if (!token) return NextResponse.json({ success: false, error: "No access token saved. Save your config first." })

      try {
        // The token must belong to the Page saved here (src/lib/meta/identify.ts).
        // A System User token is exchanged for that Page's own token, which
        // the Send API needs.
        const who = await identifyPageToken(token, rows[0]?.page_id ?? null)
        if (!who.ok) {
          await prisma.$executeRaw`
            UPDATE facebook_config SET status='error', test_error=${who.error}, last_tested_at=now(), updated_at=now()
            WHERE account_id = ${ctx.accountId}::uuid
          `
          return NextResponse.json({ success: false, error: who.error })
        }
        const taken = await prisma.$queryRaw<{ n: number }[]>`
          SELECT 1 AS n FROM facebook_config WHERE account_id <> ${ctx.accountId}::uuid AND page_id = ${who.pageId} LIMIT 1
        `
        if (taken.length > 0) {
          return NextResponse.json({ success: false, error: "This Facebook Page is already connected to another workspace." }, { status: 409 })
        }
        const sealedPageToken = who.pageToken === token ? null : sealSecret(who.pageToken)
        await prisma.$executeRaw`
          UPDATE facebook_config SET status='connected', page_id=${who.pageId}, page_name=${who.pageName},
            access_token = COALESCE(${sealedPageToken}, access_token), token_kind=${who.tokenKind},
            test_error=null, last_tested_at=now(), updated_at=now()
          WHERE account_id = ${ctx.accountId}::uuid
        `
        return NextResponse.json({ success: true, name: who.pageName ?? `Page ${who.pageId}`, page_id: who.pageId })
      } catch (e) {
        console.error("[facebook config] test failed:", e)
        return NextResponse.json({ success: false, error: "Could not reach Meta. Check the server's internet connection and try again." })
      }
    }

    // Each field checked on its own (type, length, digits-only ids).
    const fields = cleanConfigFields(body as Record<string, unknown>, { access_token: "token", verify_token: "verify_token", page_id: "id", app_secret: "app_secret" })
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 })
    const { access_token, verify_token, page_id, app_secret } = fields.value
    // A Page belongs to one CRM account. The webhook finds the account by
    // page_id, so a second claim would let one business read another's
    // Messenger conversations.
    if (page_id) {
      const taken = await prisma.$queryRaw<{ n: number }[]>`
        SELECT 1 AS n FROM facebook_config WHERE page_id = ${page_id} AND account_id <> ${ctx.accountId}::uuid LIMIT 1
      `
      if (taken.length > 0) {
        return NextResponse.json({ error: "This Facebook Page is already connected to another workspace." }, { status: 409 })
      }
    }
    const existing = await prisma.$queryRaw<{ access_token: string | null; app_secret: string | null }[]>`
      SELECT access_token, app_secret FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    // Sealed at rest (AES-256-GCM); an old plain row is sealed on this save.
    const tokenToSave = sealSecret((!access_token || access_token === MASKED) ? (existing[0]?.access_token ?? null) : (access_token || null))
    const secretToSave = sealSecret((!app_secret || app_secret === MASKED) ? (existing[0]?.app_secret ?? null) : (app_secret || null))

    await prisma.$executeRaw`
      INSERT INTO facebook_config (id, account_id, access_token, verify_token, page_id, app_secret, updated_at)
      VALUES (${randomUUID()}::uuid, ${ctx.accountId}::uuid, ${tokenToSave}, ${verify_token || null}, ${page_id || null}, ${secretToSave}, now())
      ON CONFLICT (account_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        verify_token = EXCLUDED.verify_token,
        page_id      = EXCLUDED.page_id,
        app_secret   = EXCLUDED.app_secret,
        updated_at   = now()
    `
    // Which fields were sent — never the token or the app secret.
    await auditConfigChange(auditCtx(req, ctx), "config.channel_changed", {
      area: "facebook",
      fields: ["access_token", "verify_token", "page_id", "app_secret"].filter((k) => {
        const v = (body as Record<string, unknown>)[k]
        return typeof v === "string" && v !== "" && v !== MASKED
      }),
      meta: { created: existing.length === 0 },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
