import { NextResponse } from "next/server"
import { explainMetaError, graphHost } from "@/lib/meta/social-messaging"
import { safeGraphUrl } from "@/lib/meta/social-insights"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { openStoredSecret } from "@/lib/whatsapp/encryption"

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

    const token = openStoredSecret(cfg.access_token)
    const igId  = cfg.instagram_account_id
    if (!token || !/^\d{1,30}$/.test(igId)) return NextResponse.json({ error: "Run Test Connection in Settings first." }, { status: 400 })
    // Instagram Login token → graph.instagram.com; any other → graph.facebook.com.
    const host = graphHost("instagram", token)
    const enc = encodeURIComponent(token)

    // Fetch profile + first page of media in parallel
    const [profileRes, mediaRes] = await Promise.all([
      fetch(
        `${host}/${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website&access_token=${enc}`,
        { cache: "no-store" }
      ),
      fetch(
        `${host}/${igId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=100&access_token=${enc}`,
        { cache: "no-store" }
      ),
    ])

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({})) as { error?: { message?: string; code?: number; error_subcode?: number } }
      console.error("[instagram insights] Meta error:", profileRes.status, err.error?.code, err.error?.message)
      return NextResponse.json({ error: explainMetaError(err.error, profileRes.status) }, { status: 502 })
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
        // Only Meta's own Graph host is ever followed from a "next" link.
        const next = safeGraphUrl(page.paging.next)
        if (!next) break
        const nextRes = await fetch(next, { cache: "no-store" })
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

    // Per-post insights for the newest 50 posts only: one call per post,
    // and opening the screen must not spend hundreds of Meta calls. Older
    // posts keep their likes / comments counts from the listing.
    const BATCH = 25
    const INSIGHT_POSTS = 50
    const withInsights = []

    for (let i = 0; i < Math.min(allMedia.length, INSIGHT_POSTS); i += BATCH) {
      const batch = allMedia.slice(i, Math.min(i + BATCH, INSIGHT_POSTS))
      const results = await Promise.all(
        batch.map(async (item) => {
          // Current metrics only: video_views was removed by Meta (8 Jan 2025)
          // and one removed metric fails the whole request. `views` covers videos.
          const metric  = "reach,saved,total_interactions,views"

          let reach = 0, saved = 0, videoViews = 0, totalInteractions = 0

          const res = await fetch(
            `${host}/${encodeURIComponent(item.id)}/insights?metric=${metric}&access_token=${enc}`,
            { cache: "no-store" }
          ).catch(() => null)

          if (res?.ok) {
            const body = await res.json() as InsightRes
            for (const d of body.data ?? []) {
              const val = typeof d.value === "number" ? d.value : (d.values?.[0]?.value ?? 0)
              if (d.name === "reach")              reach             = val
              if (d.name === "saved")              saved             = val
              // Meta renamed video views to "views" (Jan 2025).
              if (d.name === "views" || d.name === "video_views") videoViews = val
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
    for (const item of allMedia.slice(INSIGHT_POSTS)) {
      withInsights.push({ ...item, like_count: item.like_count ?? 0, comments_count: item.comments_count ?? 0, shares: 0, reach: 0, saved: 0, video_views: 0, total_interactions: 0 })
    }

    return NextResponse.json({ profile, media: withInsights })
  } catch (err) {
    // Not signed in / not allowed → 401/403; anything else is logged, with plain words.
    return toErrorResponse(err)
  }
}
