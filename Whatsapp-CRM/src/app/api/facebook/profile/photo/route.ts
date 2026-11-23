import { NextRequest, NextResponse } from "next/server"
import { contentMatchesType } from "@/lib/files/account-files"
import { explainMetaError } from "@/lib/meta/social-messaging"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { prisma } from "@/lib/db"
import { openStoredSecret } from "@/lib/whatsapp/encryption"
import { audit, auditCtx } from "@/lib/audit"
import { GRAPH_API_VERSION } from '@/lib/meta/versions'

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
    const uploadLimit = checkRateLimit(`upload:${ctx.userId}`, RATE_LIMITS.upload)
    if (!uploadLimit.success) return rateLimitResponse(uploadLimit)

    const rows = await prisma.$queryRaw<{ access_token: string | null; page_id: string | null }[]>`
      SELECT access_token, page_id FROM facebook_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const row = rows[0]
    if (!row?.access_token || !row?.page_id) {
      return NextResponse.json({ error: "Facebook Page is not connected yet. Set it up above first." }, { status: 400 })
    }
    if (!/^\d{1,25}$/.test(row.page_id)) {
      return NextResponse.json({ error: "Run Test Connection first so the Page is known." }, { status: 400 })
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

    // The real type, from the bytes — the browser's label is not trusted.
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!contentMatchesType(file.type, bytes)) {
      return NextResponse.json({ error: "This file is not a real PNG, JPG or WebP picture." }, { status: 400 })
    }

    const metaForm = new FormData()
    metaForm.append("source", new Blob([bytes], { type: file.type }), "page-photo")

    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${row.page_id}/picture?access_token=${encodeURIComponent(openStoredSecret(row.access_token))}`, {
      method: "POST",
      body: metaForm,
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || data.error) {
      console.error("[facebook photo] Meta error:", res.status, data.error?.code, data.error?.message)
      return NextResponse.json({ error: explainMetaError(data.error, res.status) }, { status: 502 })
    }

    await audit(auditCtx(req, ctx), {
      action: "file.uploaded",
      target: { type: "facebook_page", id: row.page_id },
      meta: { purpose: "facebook_page_photo", content_type: file.type, size: file.size },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
