import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const MASKED = "••••••••••••••••"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS instagram_config (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id           UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      access_token         TEXT,
      verify_token         TEXT,
      instagram_account_id TEXT,
      page_id              TEXT,
      status               TEXT        NOT NULL DEFAULT 'disconnected',
      ig_username          TEXT,
      ig_name              TEXT,
      last_tested_at       TIMESTAMPTZ,
      test_error           TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
}

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
      const token = rows[0]?.access_token
      if (!token) {
        return NextResponse.json({ success: false, error: "No access token saved. Save your config first." })
      }

      try {
        type IgData = { id?: string; name?: string; username?: string; error?: { message: string } }

        // Instagram Login tokens (IGQ...) → graph.instagram.com
        // Facebook Page tokens (EAA...)  → graph.facebook.com
        // Try Instagram endpoint first; fall back to Facebook endpoint.
        let data: IgData | null = null
        let ok = false

        const igRes = await fetch(
          `https://graph.instagram.com/v21.0/me?fields=id,username,name&access_token=${token}`,
          { cache: "no-store" }
        )
        const igData = await igRes.json() as IgData
        if (igRes.ok && !igData.error) {
          data = igData; ok = true
        } else {
          // Fallback: Facebook Graph API (for Page tokens)
          const fbRes = await fetch(
            `https://graph.facebook.com/v21.0/me?fields=id,name,username&access_token=${token}`,
            { cache: "no-store" }
          )
          const fbData = await fbRes.json() as IgData
          if (fbRes.ok && !fbData.error) {
            data = fbData; ok = true
          } else {
            // Report the Instagram error (more relevant for our use case)
            data = igData
          }
        }

        if (!ok || !data || data.error) {
          const msg = data?.error?.message ?? "Invalid token — check it was copied in full from Meta"
          await prisma.$executeRaw`
            UPDATE instagram_config
            SET status = 'error', test_error = ${msg}, last_tested_at = now(), updated_at = now()
            WHERE account_id = ${ctx.accountId}::uuid
          `
          return NextResponse.json({ success: false, error: msg })
        }

        await prisma.$executeRaw`
          UPDATE instagram_config
          SET status = 'connected',
              ig_username = ${data.username ?? null},
              ig_name = ${data.name ?? null},
              instagram_account_id = COALESCE(NULLIF(instagram_account_id, ''), ${data.id ?? null}),
              test_error = null,
              last_tested_at = now(),
              updated_at = now()
          WHERE account_id = ${ctx.accountId}::uuid
        `
        return NextResponse.json({ success: true, id: data.id, name: data.name, username: data.username })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Network error"
        return NextResponse.json({ success: false, error: msg })
      }
    }

    // ── Save config ──────────────────────────────────────────────
    const { access_token, verify_token, instagram_account_id, page_id } = body as Record<string, string>

    const existing = await prisma.$queryRaw<{ access_token: string | null }[]>`
      SELECT access_token FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const keepToken = !access_token || access_token === MASKED
    const tokenToSave = keepToken ? (existing[0]?.access_token ?? null) : (access_token || null)

    await prisma.$executeRaw`
      INSERT INTO instagram_config (account_id, access_token, verify_token, instagram_account_id, page_id, updated_at)
      VALUES (
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

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
