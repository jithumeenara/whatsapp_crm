import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

type FbRow = { access_token: string | null; page_id: string | null }

async function resolveFacebookAuth(accountId: string): Promise<{ error?: string; token?: string; pageId?: string }> {
  const rows = await prisma.$queryRaw<FbRow[]>`
    SELECT access_token, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `
  const row = rows[0]
  if (!row?.access_token || !row?.page_id) {
    return { error: "Facebook Page is not connected yet. Set it up above first." }
  }
  return { token: row.access_token, pageId: row.page_id }
}

/** GET /api/facebook/profile — the Page's own About/description/website/etc. */
export async function GET() {
  try {
    const ctx = await requireRole("owner")
    const { error, token, pageId } = await resolveFacebookAuth(ctx.accountId)
    if (error) return NextResponse.json({ error }, { status: 400 })

    const fields = "name,about,description,website,phone,emails,picture.type(large){url}"
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=${fields}&access_token=${token}`, { cache: "no-store" })
    const data = await res.json() as {
      name?: string; about?: string; description?: string; website?: string
      phone?: string; emails?: string[]; picture?: { data?: { url?: string } }
      error?: { message: string }
    }
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? "Failed to load Page profile" }, { status: 502 })
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

    const body = await req.json().catch(() => ({}))
    const { about, description, website, phone } = body as {
      about?: string; description?: string; website?: string; phone?: string
    }

    const params = new URLSearchParams({ access_token: token! })
    if (about !== undefined) params.set("about", about)
    if (description !== undefined) params.set("description", description)
    if (website !== undefined) params.set("website", website)
    if (phone !== undefined) params.set("phone", phone)

    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
    const data = await res.json() as { success?: boolean; error?: { message: string } }
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? "Failed to save Page profile" }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
