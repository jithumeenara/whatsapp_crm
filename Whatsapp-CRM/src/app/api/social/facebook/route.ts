import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth/account"

type FbApiError = { error?: { message: string; code?: number; type?: string } }

async function fbGet(url: string) {
  const res = await fetch(url, { cache: "no-store" })
  const json = await res.json() as Record<string, unknown> & FbApiError
  return { ok: res.ok, json, errorCode: (json.error?.code ?? 0) as number }
}

export async function GET() {
  try {
    const ctx = await requireRole("owner")

    await ctx.db.$executeRaw`
      CREATE TABLE IF NOT EXISTS facebook_config (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id   UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        access_token TEXT,
        verify_token TEXT,
        page_id      TEXT,
        app_secret   TEXT,
        status       TEXT        NOT NULL DEFAULT 'disconnected',
        page_name    TEXT,
        last_tested_at TIMESTAMPTZ,
        test_error   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch(() => {})

    const rows = await ctx.db.$queryRaw<{
      access_token: string | null
      page_id: string | null
      status: string
    }[]>`
      SELECT access_token, page_id, status
      FROM facebook_config
      WHERE account_id = ${ctx.accountId}::uuid
      LIMIT 1
    `

    const cfg = rows[0]
    if (!cfg?.access_token || !cfg.page_id) {
      return NextResponse.json({ error: "Facebook Page not connected. Go to Settings → Facebook to connect your page." }, { status: 404 })
    }

    const token  = cfg.access_token
    const pageId = cfg.page_id

    // ── Step 1: Fetch basic page info ──
    const basicPageResult = await fbGet(
      `https://graph.facebook.com/v21.0/${pageId}?fields=id,name&access_token=${token}`
    )

    // Detect permission error (code 100 = pages_read_engagement missing; 190 = bad token)
    const isPermError = (r: typeof basicPageResult) =>
      !r.ok && (r.errorCode === 100 || ((r.json.error as { message?: string } | undefined)?.message ?? "").includes("pages_read_engagement"))
    const isAuthError = (r: typeof basicPageResult) =>
      !r.ok && r.errorCode === 190

    if (!basicPageResult.ok) {
      if (isAuthError(basicPageResult)) {
        const msg = (basicPageResult.json.error as { message?: string } | undefined)?.message ?? "Invalid or expired Page Access Token"
        return NextResponse.json({ error: msg }, { status: 502 })
      }
      // Permission error or any other error on basic fetch — fall back to config page ID
      return NextResponse.json({
        page: { id: pageId, name: `Page ${pageId}` },
        posts: [],
        permission_required: true,
      })
    }

    const page: Record<string, unknown> = { ...basicPageResult.json }

    // ── Step 2: Try engagement fields — needs pages_read_engagement ──
    const engagementResult = await fbGet(
      `https://graph.facebook.com/v21.0/${pageId}?fields=about,bio,fan_count,followers_count,picture.type(large),cover&access_token=${token}`
    )
    let needsReadEngagement = false
    if (engagementResult.ok) {
      Object.assign(page, engagementResult.json)
    } else {
      needsReadEngagement = isPermError(engagementResult)
    }

    // ── Step 3: Fetch posts ──
    type PostRow = {
      id: string
      message?: string
      created_time: string
      full_picture?: string
      reactions?: { summary: { total_count: number } }
      comments?: { summary: { total_count: number } }
      shares?: { count: number }
    }

    let withInsights: unknown[] = []
    let postsError: string | null = null

    if (!needsReadEngagement) {
      // Use /me/feed with the Page Access Token (acts as the page itself)
      // reactions.summary(true) gets total reaction/like count; comments.summary(true) gets comment count
      const postsResult = await fbGet(
        `https://graph.facebook.com/v21.0/me/feed?fields=id,message,created_time,full_picture,reactions.summary(true),comments.summary(true),shares&limit=30&access_token=${token}`
      )

      if (!postsResult.ok) {
        // Fallback: try /{pageId}/posts with minimal fields
        const fallbackResult = await fbGet(
          `https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,message,created_time,full_picture&limit=30&access_token=${token}`
        )
        if (!fallbackResult.ok) {
          postsError = (fallbackResult.json.error as { message?: string } | undefined)?.message ?? "Could not load posts"
          console.error("[social/facebook] posts error:", postsError)
        } else {
          const postItems = ((fallbackResult.json.data ?? []) as PostRow[]).slice(0, 24)
          withInsights = postItems.map((post) => ({
            id: post.id, message: post.message, created_time: post.created_time,
            full_picture: post.full_picture, likes: 0, comments: 0, shares: 0,
            reach: 0, impressions: 0, engaged_users: 0, clicks: 0, reactions: [],
          }))
        }
      } else {
        const postItems = ((postsResult.json.data ?? []) as PostRow[]).slice(0, 24)

        withInsights = await Promise.all(
          postItems.map(async (post) => {
            // Post insights need read_insights permission — silently ignore if missing
            const insResult = await fbGet(
              `https://graph.facebook.com/v21.0/${post.id}/insights?metric=post_impressions,post_reach,post_engaged_users,post_clicks&access_token=${token}`
            ).catch(() => null)

            let reach = 0, impressions = 0, engagedUsers = 0, clicks = 0
            if (insResult?.ok) {
              for (const d of (insResult.json.data as Array<{ name: string; values: Array<{ value: number }> }> ?? [])) {
                const val = d.values?.[0]?.value ?? 0
                if (d.name === "post_reach")         reach        = val
                if (d.name === "post_impressions")   impressions  = val
                if (d.name === "post_engaged_users") engagedUsers = val
                if (d.name === "post_clicks")        clicks       = val
              }
            }

            const reactResult = await fbGet(
              `https://graph.facebook.com/v21.0/${post.id}/reactions?fields=id,name,pic_large,type&limit=50&access_token=${token}`
            ).catch(() => null)
            const reactions = reactResult?.ok ? ((reactResult.json.data ?? []) as unknown[]) : []

            return {
              id:            post.id,
              message:       post.message,
              created_time:  post.created_time,
              full_picture:  post.full_picture,
              likes:         post.reactions?.summary?.total_count ?? 0,
              comments:      post.comments?.summary?.total_count ?? 0,
              shares:        post.shares?.count ?? 0,
              reach,
              impressions,
              engaged_users: engagedUsers,
              clicks,
              reactions,
            }
          })
        )
      }
    }

    return NextResponse.json({
      page,
      posts: withInsights,
      permission_required: needsReadEngagement,
      posts_error: postsError,
    })
  } catch (err) {
    console.error("[social/facebook]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
