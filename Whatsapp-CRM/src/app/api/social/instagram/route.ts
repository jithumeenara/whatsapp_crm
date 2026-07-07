import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth/account"

export async function GET() {
  try {
    const ctx = await requireRole("owner")

    const rows = await ctx.db.$queryRaw<{
      access_token: string | null
      instagram_account_id: string | null
      status: string
    }[]>`
      SELECT access_token, instagram_account_id, status
      FROM instagram_config
      WHERE account_id = ${ctx.accountId}::uuid
      LIMIT 1
    `

    const cfg = rows[0]
    if (!cfg?.access_token || !cfg.instagram_account_id || cfg.status !== "connected") {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 404 })
    }

    const token = cfg.access_token
    const igId  = cfg.instagram_account_id

    // Fetch profile + first page of media in parallel
    const [profileRes, mediaRes] = await Promise.all([
      fetch(
        `https://graph.instagram.com/v21.0/${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website&access_token=${token}`,
        { cache: "no-store" }
      ),
      fetch(
        `https://graph.instagram.com/v21.0/${igId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=100&access_token=${token}`,
        { cache: "no-store" }
      ),
    ])

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({})) as { error?: { message: string } }
      return NextResponse.json({ error: err.error?.message ?? "Failed to fetch Instagram profile" }, { status: 502 })
    }

    const profile = await profileRes.json()

    type RawMedia = {
      id: string
      caption?: string
      media_type: string
      media_url?: string
      thumbnail_url?: string
      permalink: string
      timestamp: string
      like_count?: number
      comments_count?: number
    }

    type MediaPage = { data?: RawMedia[]; paging?: { next?: string } }

    // Collect all pages of media (up to 5 pages = 500 posts)
    let allMedia: RawMedia[] = []
    if (mediaRes.ok) {
      let page = await mediaRes.json() as MediaPage
      allMedia = [...(page.data ?? [])]
      let pageCount = 0
      while (page.paging?.next && pageCount < 4) {
        const nextRes = await fetch(page.paging.next, { cache: "no-store" })
        if (!nextRes.ok) break
        page = await nextRes.json() as MediaPage
        allMedia = [...allMedia, ...(page.data ?? [])]
        pageCount++
      }
    }

    // like_count and comments_count from the media listing are already accurate.
    // We only need insights for reach, saved, and video_views.
    // Batch at 25 to avoid rate limits while keeping response time reasonable.
    type InsightData = { name: string; value?: number; values?: Array<{ value: number }> }
    type InsightRes  = { data?: InsightData[]; error?: { message: string } }

    const BATCH = 25
    const withInsights = []

    for (let i = 0; i < allMedia.length; i += BATCH) {
      const batch = allMedia.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async (item) => {
          const isVideo = item.media_type === "VIDEO"
          const metric  = isVideo ? "reach,saved,video_views,total_interactions" : "reach,saved,total_interactions"

          let reach = 0, saved = 0, videoViews = 0, totalInteractions = 0

          const res = await fetch(
            `https://graph.instagram.com/v21.0/${item.id}/insights?metric=${metric}&access_token=${token}`,
            { cache: "no-store" }
          ).catch(() => null)

          if (res?.ok) {
            const body = await res.json() as InsightRes
            for (const d of body.data ?? []) {
              const val = typeof d.value === "number" ? d.value : (d.values?.[0]?.value ?? 0)
              if (d.name === "reach")              reach             = val
              if (d.name === "saved")              saved             = val
              if (d.name === "video_views")        videoViews        = val
              if (d.name === "total_interactions") totalInteractions = val
            }
          }

          return {
            ...item,
            like_count:         item.like_count     ?? 0,
            comments_count:     item.comments_count ?? 0,
            shares:             0,
            reach,
            saved,
            video_views:        videoViews,
            total_interactions: totalInteractions,
          }
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withInsights.push(...(results as any))
    }

    return NextResponse.json({ profile, media: withInsights })
  } catch (err) {
    console.error("[social/instagram]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
