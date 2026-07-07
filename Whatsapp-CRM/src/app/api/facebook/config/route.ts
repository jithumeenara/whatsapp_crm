import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const MASKED = "••••••••••••••••"

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS facebook_config (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id   UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      access_token TEXT,
      verify_token TEXT,
      page_id      TEXT,
      app_secret   TEXT,
      status       TEXT        NOT NULL DEFAULT 'disconnected',
      page_name    TEXT,
      last_tested_at TIMESTAMPTZ,
      test_error   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.catch(() => {})
}

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
      const token = rows[0]?.access_token
      if (!token) return NextResponse.json({ success: false, error: "No access token saved. Save your config first." })

      try {
        type FbError = { message: string; type?: string; code?: number }
        // Test by attempting a Messenger send to a dummy PSID.
        // A valid token returns error code 2018109 (recipient not found) — NOT 190 (bad token).
        // This avoids needing pages_read_engagement which requires Meta app review.
        const testRes = await fetch(
          `https://graph.facebook.com/v21.0/me/messages?access_token=${token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient: { id: "0" }, message: { text: "ping" } }),
            cache: "no-store",
          }
        )
        const testData = await testRes.json() as { error?: FbError }
        const errCode = testData.error?.code ?? 0

        // Code 190 = invalid/expired token (OAuthException)
        // Code 10 = no pages_messaging permission on token
        // Code 2018109 / 100 with "recipient" in message = valid token, bad recipient (expected)
        const isAuthError = errCode === 190
        const isPermError = errCode === 10
        const msg = testData.error?.message ?? ""

        if (isAuthError) {
          await prisma.$executeRaw`
            UPDATE facebook_config SET status='error', test_error=${msg}, last_tested_at=now(), updated_at=now()
            WHERE account_id = ${ctx.accountId}::uuid
          `
          return NextResponse.json({ success: false, error: "Token is invalid or expired. Generate a new Page Access Token in Meta Developer Console → Messenger → API Settings." })
        }

        if (isPermError) {
          await prisma.$executeRaw`
            UPDATE facebook_config SET status='error', test_error=${msg}, last_tested_at=now(), updated_at=now()
            WHERE account_id = ${ctx.accountId}::uuid
          `
          return NextResponse.json({ success: false, error: "Token is missing pages_messaging permission. Make sure you generated a Page Access Token (not a User token) from Messenger → API Settings → Access Tokens." })
        }

        // Any other error (recipient not found, etc.) means the token is valid
        const savedRow = rows[0]
        const pageName = savedRow?.page_id ? `Page ${savedRow.page_id}` : "Facebook Page"
        await prisma.$executeRaw`
          UPDATE facebook_config SET status='connected', page_name=${pageName},
            test_error=null, last_tested_at=now(), updated_at=now()
          WHERE account_id = ${ctx.accountId}::uuid
        `
        return NextResponse.json({ success: true, name: pageName })
      } catch (e) {
        return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Network error" })
      }
    }

    const { access_token, verify_token, page_id, app_secret } = body as Record<string, string>
    const existing = await prisma.$queryRaw<{ access_token: string | null; app_secret: string | null }[]>`
      SELECT access_token, app_secret FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const tokenToSave = (!access_token || access_token === MASKED) ? (existing[0]?.access_token ?? null) : (access_token || null)
    const secretToSave = (!app_secret || app_secret === MASKED) ? (existing[0]?.app_secret ?? null) : (app_secret || null)

    await prisma.$executeRaw`
      INSERT INTO facebook_config (account_id, access_token, verify_token, page_id, app_secret, updated_at)
      VALUES (${ctx.accountId}::uuid, ${tokenToSave}, ${verify_token || null}, ${page_id || null}, ${secretToSave}, now())
      ON CONFLICT (account_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        verify_token = EXCLUDED.verify_token,
        page_id      = EXCLUDED.page_id,
        app_secret   = EXCLUDED.app_secret,
        updated_at   = now()
    `
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
