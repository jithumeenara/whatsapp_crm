import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { ensureInstagramConfigTable as ensureTable } from "@/lib/social/ensure-tables"

export interface IceBreaker { question: string; payload: string }
export type MenuItem =
  | { title: string; payload: string }
  | { title: string; type: "web_url"; url: string }

const MAX_ICE_BREAKERS = 4
const MAX_MENU_ITEMS = 3

type RawRow = {
  access_token: string | null
  ice_breakers: IceBreaker[] | null
  persistent_menu: MenuItem[] | null
  profile_synced_at: Date | null
}

export async function GET() {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token, ice_breakers, persistent_menu, profile_synced_at
      FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    return NextResponse.json({
      has_token: Boolean(row?.access_token),
      ice_breakers: row?.ice_breakers ?? [],
      persistent_menu: row?.persistent_menu ?? [],
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

    const iceBreakers = (body.ice_breakers ?? []) as IceBreaker[]
    const persistentMenu = (body.persistent_menu ?? []) as MenuItem[]

    if (iceBreakers.length > MAX_ICE_BREAKERS) {
      return NextResponse.json({ error: `Instagram allows at most ${MAX_ICE_BREAKERS} ice breakers.` }, { status: 400 })
    }
    if (persistentMenu.length > MAX_MENU_ITEMS) {
      return NextResponse.json({ error: `Instagram allows at most ${MAX_MENU_ITEMS} persistent menu items.` }, { status: 400 })
    }
    for (const ib of iceBreakers) {
      if (!ib.question?.trim() || !ib.payload?.trim()) {
        return NextResponse.json({ error: "Every ice breaker needs both a question and a payload." }, { status: 400 })
      }
    }
    for (const item of persistentMenu) {
      if (!item.title?.trim()) {
        return NextResponse.json({ error: "Every menu item needs a title." }, { status: 400 })
      }
      if ("type" in item && item.type === "web_url" && !item.url?.trim()) {
        return NextResponse.json({ error: "Every link menu item needs a URL." }, { status: 400 })
      }
    }

    await ensureTable()
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token, ice_breakers, persistent_menu, profile_synced_at
      FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = rows[0]?.access_token
    if (!token) {
      return NextResponse.json({ error: "Connect Instagram first — no access token saved." }, { status: 400 })
    }

    // One Graph API call syncs both ice breakers and the persistent menu —
    // Meta requires call_to_actions wrapped per-locale even for a single
    // default locale.
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/messenger_profile?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ice_breakers: iceBreakers.map((ib) => ({ question: ib.question, payload: ib.payload })),
          persistent_menu: [
            {
              locale: "default",
              composer_input_disabled: false,
              call_to_actions: persistentMenu,
            },
          ],
        }),
      },
    )
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? "Meta rejected the request." }, { status: 502 })
    }

    await prisma.$executeRaw`
      UPDATE instagram_config
      SET ice_breakers = ${JSON.stringify(iceBreakers)}::jsonb,
          persistent_menu = ${JSON.stringify(persistentMenu)}::jsonb,
          profile_synced_at = now(),
          updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("owner")
    await ensureTable()
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT access_token FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = rows[0]?.access_token
    if (token) {
      await fetch(
        `https://graph.instagram.com/v21.0/me/messenger_profile?fields=ice_breakers,persistent_menu&access_token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      ).catch(() => {})
    }
    await prisma.$executeRaw`
      UPDATE instagram_config
      SET ice_breakers = NULL, persistent_menu = NULL, profile_synced_at = NULL, updated_at = now()
      WHERE account_id = ${ctx.accountId}::uuid
    `
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
