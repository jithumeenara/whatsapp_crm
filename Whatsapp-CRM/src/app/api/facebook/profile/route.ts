import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { openStoredSecret } from "@/lib/whatsapp/encryption"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { explainMetaError } from '@/lib/meta/social-messaging'

type FbRow = { access_token: string | null; page_id: string | null }

async function resolveFacebookAuth(accountId: string): Promise<{ error?: string; token?: string; pageId?: string }> {
  const rows = await prisma.$queryRaw<FbRow[]>`
    SELECT access_token, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `
  const row = rows[0]
  const token = openStoredSecret(row?.access_token ?? null)
  if (!token || !row?.page_id) {
    return { error: "Facebook Page is not connected yet — set it up in Settings > Facebook first." }
  }
  // Only a numeric Page id ever goes into the Graph URL.
  if (!/^\d{5,25}$/.test(row.page_id)) return { error: "Run Test Connection first so the Page is known." }
  return { token, pageId: row.page_id }
}

/** GET /api/facebook/profile — the Page's own About/description/website/etc. */
export async function GET() {
  try {
    const ctx = await requireRole("owner")
    const { error, token, pageId } = await resolveFacebookAuth(ctx.accountId)
    if (error) return NextResponse.json({ error }, { status: 400 })

    const fields = "name,about,description,website,phone,emails,picture.type(large){url}"
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}?fields=${fields}&access_token=${encodeURIComponent(token ?? "")}`, { cache: "no-store" })
    const data = await res.json() as {
      name?: string; about?: string; description?: string; website?: string
      phone?: string; emails?: string[]; picture?: { data?: { url?: string } }
      error?: { message?: string; code?: number; error_subcode?: number }
    }
    if (!res.ok || data.error) {
      console.error("[facebook profile] Meta error:", res.status, data.error?.code, data.error?.message)
      return NextResponse.json({ error: explainMetaError(data.error, res.status) }, { status: 502 })
    }

    return NextResponse.json({
      name: data.name ?? "",
      about: data.about ?? "",
      description: data.description ?? "",
      website: data.website ?? "",
      phone: data.phone ?? "",
      email: data.emails?.[0] ?? "",
      pictureUrl: data.picture?.data?.url ?? "",
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/facebook/profile — body: { about?, description?, website?, phone?, email? } */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")
    const { error, token, pageId } = await resolveFacebookAuth(ctx.accountId)
    if (error) return NextResponse.json({ error }, { status: 400 })

    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    // Each field checked on its own: text only, Meta's lengths, https site.
    const LIMITS = { about: 255, description: 5000, website: 500, phone: 40 } as const
    const params = new URLSearchParams({ access_token: token! })
    for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      const v = body[key]
      if (v === undefined) continue
      if (typeof v !== "string") return NextResponse.json({ error: `${key} must be text.` }, { status: 400 })
      const t = v.trim()
      if (t.length > LIMITS[key]) return NextResponse.json({ error: `${key} can be at most ${LIMITS[key]} characters.` }, { status: 400 })
      if (key === "website" && t && !/^https?:\/\/[^\s]+$/i.test(t)) return NextResponse.json({ error: "The website must start with https:// or http://" }, { status: 400 })
      if (key === "phone" && t && !/^[+\d][\d\s()-]{3,39}$/.test(t)) return NextResponse.json({ error: "Enter the phone number with digits only (a leading + is fine)." }, { status: 400 })
      params.set(key, t)
    }

    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || data.error) {
      console.error("[facebook profile] Meta error:", res.status, data.error?.code, data.error?.message)
      return NextResponse.json({ error: explainMetaError(data.error, res.status) }, { status: 502 })
    }

    // Which Page fields were sent to Meta — never their text.
    await auditConfigChange(auditCtx(req, ctx), "config.channel_changed", {
      area: "facebook_page_profile",
      fields: (["about", "description", "website", "phone"] as const).filter((k) => body[k] !== undefined),
      target: { type: "facebook_page", id: pageId },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
