import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { prisma } from "@/lib/db"
import { cleanProfile, fieldsToClear, profileRequestBody, storedProfile } from "@/lib/meta/messenger-profile"
import { explainMetaError } from "@/lib/meta/social-messaging"
import { GRAPH_API_VERSION } from "@/lib/meta/versions"
import { ensureFacebookConfigTable as ensureTable } from "@/lib/social/ensure-tables"
import { openStoredSecret } from "@/lib/whatsapp/encryption"

/**
 * /api/facebook/messenger-profile — the Page's Messenger "front door":
 * greeting, Get Started button, ice breakers and persistent menu.
 * Owner only. Input is rebuilt field by field (cleanProfile); the Page
 * token never leaves the server.
 */

type Row = { access_token: string | null; page_id: string | null; messenger_profile: unknown; profile_synced_at: Date | null }
type MetaError = { error?: { message?: string; code?: number; error_subcode?: number } }

async function loadRow(accountId: string): Promise<Row | undefined> {
  await ensureTable()
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT access_token, page_id, messenger_profile, profile_synced_at
    FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `
  return rows[0]
}

/** The Page's messenger_profile endpoint, or a plain reason it cannot be used. */
function endpoint(row: Row | undefined): { url: string } | { error: string } {
  const token = openStoredSecret(row?.access_token ?? null)
  if (!token) return { error: "Connect Messenger first — no Page token saved." }
  const pageId = row?.page_id ?? ""
  if (!/^\d{5,25}$/.test(pageId)) return { error: "Run Test Connection first so the Page is known." }
  return { url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/messenger_profile?access_token=${encodeURIComponent(token)}` }
}

export async function GET() {
  try {
    const ctx = await requireRole("owner")
    const row = await loadRow(ctx.accountId)
    const profile = storedProfile(row?.messenger_profile as Record<string, unknown> | null, "facebook")
    return NextResponse.json({
      has_token: Boolean(row?.access_token),
      ...profile,
      profile_synced_at: row?.profile_synced_at ?? null,
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
    const clean = cleanProfile(body, "facebook")
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
    const profile = clean.value

    const row = await loadRow(ctx.accountId)
    const ep = endpoint(row)
    if ("error" in ep) return NextResponse.json({ error: ep.error }, { status: 400 })

    const setBody = profileRequestBody(profile, "facebook")
    if (Object.keys(setBody).length > 0) {
      const res = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setBody) })
      const data = (await res.json().catch(() => ({}))) as MetaError
      if (!res.ok || data.error) {
        console.error("[messenger profile] Meta error:", res.status, data.error?.code, data.error?.message)
        return NextResponse.json({ error: explainMetaError(data.error, res.status) }, { status: 502 })
      }
    }
    const clear = fieldsToClear(profile, "facebook")
    if (clear.length > 0) {
      await fetch(ep.url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: clear }) })
        .catch((e) => console.warn("[messenger profile] clear skipped:", e instanceof Error ? e.message : e))
    }

    await prisma.$executeRaw`
      UPDATE facebook_config
      SET messenger_profile = ${JSON.stringify(profile)}::jsonb, profile_synced_at = now(), updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `
    await auditConfigChange(auditCtx(req, ctx), "config.channel_changed", {
      area: "messenger_profile",
      fields: ["greeting", "get_started", "ice_breakers", "persistent_menu"],
      meta: { ice_breakers: profile.ice_breakers.length, menu_items: profile.persistent_menu.length, greeting: Boolean(profile.greeting), get_started: profile.get_started },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req?: Request) {
  try {
    const ctx = await requireRole("owner")
    const row = await loadRow(ctx.accountId)
    const ep = endpoint(row)
    if (!("error" in ep)) {
      await fetch(ep.url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["persistent_menu", "ice_breakers", "greeting", "get_started"] }),
      }).catch(() => {})
    }
    await prisma.$executeRaw`
      UPDATE facebook_config SET messenger_profile = NULL, profile_synced_at = NULL, updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `
    await auditConfigChange(auditCtx(req ?? null, ctx), "config.channel_changed", {
      area: "messenger_profile",
      fields: ["greeting", "get_started", "ice_breakers", "persistent_menu"],
      meta: { removed: true },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
