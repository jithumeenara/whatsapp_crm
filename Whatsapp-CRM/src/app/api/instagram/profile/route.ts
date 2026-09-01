import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

type IgData = {
  id?: string; username?: string; name?: string; biography?: string
  profile_picture_url?: string; followers_count?: number
  error?: { message: string }
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

    const rows = await prisma.$queryRaw<{ access_token: string | null }[]>`
      SELECT access_token FROM instagram_config WHERE account_id = ${ctx.accountId}::uuid LIMIT 1
    `
    const token = rows[0]?.access_token
    if (!token) {
      return NextResponse.json({ error: "Instagram is not connected yet. Set it up above first." }, { status: 400 })
    }

    // Instagram Login tokens (IGQ...) → graph.instagram.com; Facebook Page
    // tokens (EAA...) → graph.facebook.com. Same fallback the "test" action
    // in /api/instagram/config already uses.
    let data: IgData | null = null
    const igRes = await fetch(`https://graph.instagram.com/v21.0/me?fields=${FIELDS}&access_token=${token}`, { cache: "no-store" })
    const igData = await igRes.json() as IgData
    if (igRes.ok && !igData.error) {
      data = igData
    } else {
      const fbRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=${FIELDS}&access_token=${token}`, { cache: "no-store" })
      const fbData = await fbRes.json() as IgData
      if (fbRes.ok && !fbData.error) data = fbData
      else return NextResponse.json({ error: (fbData.error ?? igData.error)?.message ?? "Failed to load Instagram profile" }, { status: 502 })
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
