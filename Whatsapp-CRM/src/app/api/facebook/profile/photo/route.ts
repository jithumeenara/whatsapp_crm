import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"])

/**
 * POST /api/facebook/profile/photo — multipart upload (field "photo"),
 * forwarded server-to-server straight to Meta as the Page's new profile
 * picture. Deliberately NOT routed through this app's own /api/upload +
 * a hosted URL — that endpoint requires a login session to read back, and
 * Meta's servers fetching a `url=` picture param can't present one, so the
 * raw bytes have to go directly from here to Meta instead.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")

    const rows = await prisma.$queryRaw<{ access_token: string | null; page_id: string | null }[]>`
      SELECT access_token, page_id FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    if (!row?.access_token || !row?.page_id) {
      return NextResponse.json({ error: "Facebook Page is not connected yet. Set it up above first." }, { status: 400 })
    }

    const formData = await req.formData().catch(() => null)
    const file = formData?.get("photo")
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No photo file received" }, { status: 400 })
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Use PNG, JPG, or WebP" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Maximum 5 MB" }, { status: 400 })
    }

    const metaForm = new FormData()
    metaForm.append("source", file, file.name)

    const res = await fetch(`https://graph.facebook.com/v21.0/${row.page_id}/picture?access_token=${row.access_token}`, {
      method: "POST",
      body: metaForm,
    })
    const data = await res.json() as { success?: boolean; error?: { message: string } }
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? "Failed to update the Page photo" }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
