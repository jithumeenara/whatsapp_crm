import { NextRequest, NextResponse } from "next/server"
import { explainMetaError, igNodeUrl } from "@/lib/meta/social-messaging"
import { cleanProfile, fieldsToClear, profileRequestBody, storedProfile } from "@/lib/meta/messenger-profile"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { prisma } from "@/lib/db"
import { ensureInstagramConfigTable as ensureTable } from "@/lib/social/ensure-tables"
import { openStoredSecret } from "@/lib/whatsapp/encryption"

export type { IceBreaker, MenuItem } from "@/lib/meta/messenger-profile"

type RawRow = {
  access_token: string | null
  instagram_account_id?: string | null
  ice_breakers: unknown
  persistent_menu: unknown
  profile_synced_at: Date | null
}

type MetaError = { error?: { message?: string; code?: number; error_subcode?: number } }

export async function GET() {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token, instagram_account_id, ice_breakers, persistent_menu, profile_synced_at
      FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    const profile = storedProfile({ ice_breakers: row?.ice_breakers, persistent_menu: row?.persistent_menu }, "instagram")
    return NextResponse.json({
      has_token: Boolean(row?.access_token),
      ice_breakers: profile.ice_breakers,
      persistent_menu: profile.persistent_menu,
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

    // Rebuilt field by field: nothing else reaches Meta or the database.
    const clean = cleanProfile(body, "instagram")
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
    const profile = clean.value

    await ensureTable()
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token, instagram_account_id, ice_breakers, persistent_menu, profile_synced_at
      FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = openStoredSecret(rows[0]?.access_token)
    if (!token) {
      return NextResponse.json({ error: "Connect Instagram first — no access token saved." }, { status: 400 })
    }
    const profileUrl = igNodeUrl(token, rows[0]?.instagram_account_id, "/messenger_profile?platform=instagram")
    if (!profileUrl) return NextResponse.json({ error: "Run Test Connection first so the Instagram account is known." }, { status: 400 })
    const authed = `${profileUrl}&access_token=${encodeURIComponent(token)}`

    // Set what the owner filled in; clear what they emptied.
    const setBody = profileRequestBody(profile, "instagram")
    if (Object.keys(setBody).length > 0) {
      const res = await fetch(authed, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setBody) })
      const data = (await res.json().catch(() => ({}))) as MetaError
      if (!res.ok || data.error) {
        console.error("[instagram profile] Meta error:", res.status, data.error?.code, data.error?.message)
        return NextResponse.json({ error: explainMetaError(data.error, res.status) }, { status: 502 })
      }
    }
    const clear = fieldsToClear(profile, "instagram")
    if (clear.length > 0) {
      await fetch(authed, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: clear }) })
        .catch((e) => console.warn("[instagram profile] clear skipped:", e instanceof Error ? e.message : e))
    }

    await prisma.$executeRaw`
      UPDATE instagram_config
      SET ice_breakers = ${JSON.stringify(profile.ice_breakers)}::jsonb,
          persistent_menu = ${JSON.stringify(profile.persistent_menu)}::jsonb,
          profile_synced_at = now(),
          updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `

    await auditConfigChange(auditCtx(req, ctx), "config.channel_changed", {
      area: "instagram_ice_breakers",
      fields: ["ice_breakers", "persistent_menu"],
      meta: { ice_breakers: profile.ice_breakers.length, menu_items: profile.persistent_menu.length },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req?: Request) {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token, instagram_account_id FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = openStoredSecret(rows[0]?.access_token)
    const profileUrl = token ? igNodeUrl(token, rows[0]?.instagram_account_id, "/messenger_profile?platform=instagram") : null
    if (token && profileUrl) {
      await fetch(`${profileUrl}&access_token=${encodeURIComponent(token)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["ice_breakers", "persistent_menu"] }),
      }).catch(() => {})
    }
    await prisma.$executeRaw`
      UPDATE instagram_config
      SET ice_breakers = NULL, persistent_menu = NULL, profile_synced_at = NULL, updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `
    await auditConfigChange(auditCtx(req ?? null, ctx), "config.channel_changed", {
      area: "instagram_ice_breakers",
      fields: ["ice_breakers", "persistent_menu"],
      meta: { removed: true },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
