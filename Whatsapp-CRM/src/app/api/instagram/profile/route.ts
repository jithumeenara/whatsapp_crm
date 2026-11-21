import { NextResponse } from "next/server"
import { explainMetaError, igNodeUrl } from "@/lib/meta/social-messaging"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { openStoredSecret } from "@/lib/whatsapp/encryption"

type IgData = {
  id?: string; username?: string; name?: string; biography?: string
  profile_picture_url?: string; followers_count?: number
  error?: { message?: string; code?: number; error_subcode?: number }
}

const FIELDS = "id,username,name,biography,profile_picture_url,followers_count"

/**
 * GET /api/instagram/profile — READ ONLY. Meta's Graph API has no write
 * endpoint for an Instagram professional account's bio/name/photo — those
 * can only be changed inside the Instagram app itself or Business Suite.
 * This just surfaces the live profile for a preview + an outbound link.
 */
export async function GET() {
  try {
    const ctx = await requireRole("owner")

    const rows = await prisma.$queryRaw<{ access_token: string | null; instagram_account_id: string | null }[]>`
      SELECT access_token, instagram_account_id FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = openStoredSecret(rows[0]?.access_token)
    if (!token) {
      return NextResponse.json({ error: "Instagram is not connected yet — set it up in Settings > Instagram first." }, { status: 400 })
    }

    // Instagram Login token → graph.instagram.com/me; any other token → the
    // Instagram account on graph.facebook.com (src/lib/meta/social-messaging.ts).
    const url = igNodeUrl(token, rows[0]?.instagram_account_id, `?fields=${FIELDS}`)
    if (!url) return NextResponse.json({ error: "Run Test Connection first so the Instagram account is known." }, { status: 400 })
    const igRes = await fetch(`${url}&access_token=${encodeURIComponent(token)}`, { cache: "no-store" })
    const data = await igRes.json().catch(() => ({})) as IgData
    if (!igRes.ok || data.error) {
      console.error("[instagram profile] Meta error:", igRes.status, data.error?.code, data.error?.message)
      return NextResponse.json({ error: explainMetaError(data.error, igRes.status) }, { status: 502 })
    }

    return NextResponse.json({
      username: data.username ?? "",
      name: data.name ?? "",
      biography: data.biography ?? "",
      profilePictureUrl: data.profile_picture_url ?? "",
      followersCount: data.followers_count ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
