import { randomUUID } from 'node:crypto'
import { identifyInstagramToken } from "@/lib/meta/identify"
import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { cleanConfigFields } from "@/lib/meta/config-fields"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { prisma } from "@/lib/db"
import { openStoredSecret, sealSecret } from "@/lib/whatsapp/encryption"
import { ensureInstagramConfigTable as ensureTable } from "@/lib/social/ensure-tables"

const MASKED = "••••••••••••••••"

type RawRow = {
  id: string
  account_id: string
  access_token: string | null
  verify_token: string | null
  instagram_account_id: string | null
  page_id: string | null
  status: string
  ig_username: string | null
  ig_name: string | null
  last_tested_at: Date | null
  test_error: string | null
  comment_dm_status: string | null
}

export async function GET() {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT * FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return NextResponse.json({ configured: false })
    }

    return NextResponse.json({
      configured: true,
      status: row.status,
      instagram_account_id: row.instagram_account_id ?? "",
      page_id: row.page_id ?? "",
      verify_token: row.verify_token ?? "",
      access_token: row.access_token ? MASKED : "",
      ig_username: row.ig_username,
      ig_name: row.ig_name,
      last_tested_at: row.last_tested_at,
      test_error: row.test_error,
      comment_dm_status: row.comment_dm_status ?? "pending_meta_approval",
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

    // ── Test connection ─────────────────────────────────────────
    if (action === "test") {
      const rows = await prisma.$queryRaw<RawRow[]>`
        SELECT * FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
      `
      const token = openStoredSecret(rows[0]?.access_token)
      if (!token) {
        return NextResponse.json({ success: false, error: "No access token saved. Save your config first." })
      }

      try {
        // Which account the token belongs to, read from Meta (src/lib/meta/identify.ts):
        // the professional account id webhooks carry — never the app-scoped /me id.
        const who = await identifyInstagramToken(token, rows[0]?.instagram_account_id ?? null)
        if (!who.ok) {
          await prisma.$executeRaw`
            UPDATE instagram_config
            SET status = 'error', test_error = ${who.error}, last_tested_at = now(), updated_at = now()
            WHERE account_id = ${ctx.accountId}::uuid
          `
          return NextResponse.json({ success: false, error: who.error })
        }

        // One workspace per Instagram account: webhooks route by this id.
        const taken = await prisma.$queryRaw<{ n: number }[]>`
          SELECT 1 AS n FROM instagram_config
          WHERE account_id <> ${ctx.accountId}::uuid AND instagram_account_id = ${who.igAccountId} LIMIT 1
        `
        if (taken.length > 0) {
          return NextResponse.json({ success: false, error: "This Instagram account is already connected to another workspace." }, { status: 409 })
        }

        await prisma.$executeRaw`
          UPDATE instagram_config
          SET status = 'connected',
              ig_username = ${who.username},
              ig_name = ${who.name},
              instagram_account_id = ${who.igAccountId},
              page_id = COALESCE(${who.pageId}, page_id),
              token_kind = ${who.tokenKind},
              test_error = null,
              last_tested_at = now(),
              updated_at = now()
          WHERE account_id = ${ctx.accountId}::uuid
        `
        return NextResponse.json({
          success: true, id: who.igAccountId, name: who.name, username: who.username, token_kind: who.tokenKind,
          ...(who.others > 0 ? { note: `This token can also reach ${who.others} other Instagram account(s); the saved one was used.` } : {}),
        })
      } catch (e) {
        console.error("[instagram config] test failed:", e)
        return NextResponse.json({ success: false, error: "Could not reach Meta. Check the server's internet connection and try again." })
      }
    }

    // ── Save config ──────────────────────────────────────────────
    // Each field checked on its own (type, length, digits-only ids).
    const fields = cleanConfigFields(body as Record<string, unknown>, { access_token: "token", verify_token: "verify_token", instagram_account_id: "id", page_id: "id" })
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 })
    const { access_token, verify_token, instagram_account_id, page_id } = fields.value

    // An Instagram account (or its Page) belongs to one CRM account. The
    // webhook finds the account by these ids, so a second claim would let
    // one business read another's DMs.
    for (const id of [instagram_account_id, page_id]) {
      if (!id) continue
      const taken = await prisma.$queryRaw<{ n: number }[]>`
        SELECT 1 AS n FROM instagram_config
        WHERE account_id <> ${ctx.accountId}::uuid AND (instagram_account_id = ${id} OR page_id = ${id}) LIMIT 1
      `
      if (taken.length > 0) {
        return NextResponse.json({ error: "This Instagram account is already connected to another workspace." }, { status: 409 })
      }
    }

    const existing = await prisma.$queryRaw<{ access_token: string | null }[]>`
      SELECT access_token FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const keepToken = !access_token || access_token === MASKED
    // Sealed at rest (AES-256-GCM); an old plain row is sealed on this save.
    const tokenToSave = sealSecret(keepToken ? (existing[0]?.access_token ?? null) : (access_token || null))

    await prisma.$executeRaw`
      INSERT INTO instagram_config (id, account_id, access_token, verify_token, instagram_account_id, page_id, updated_at)
      VALUES (
        ${randomUUID()}::uuid,
        ${ctx.accountId}::uuid,
        ${tokenToSave},
        ${verify_token || null},
        ${instagram_account_id || null},
        ${page_id || null},
        now()
      )
      ON CONFLICT (account_id) DO UPDATE SET
        access_token         = EXCLUDED.access_token,
        verify_token         = EXCLUDED.verify_token,
        instagram_account_id = EXCLUDED.instagram_account_id,
        page_id              = EXCLUDED.page_id,
        updated_at           = now()
    `

    await auditConfigChange(auditCtx(req, ctx), "config.channel_changed", {
      area: "instagram",
      fields: ["access_token", "verify_token", "instagram_account_id", "page_id"].filter((k) => {
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
