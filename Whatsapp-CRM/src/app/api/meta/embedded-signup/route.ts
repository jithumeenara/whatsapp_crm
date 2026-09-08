import { randomInt } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/whatsapp/encryption"
import { loadMetaPlatformConfig } from "@/lib/whatsapp/meta-platform-config"
import { ensureFacebookConfigTable, ensureInstagramConfigTable } from "@/lib/social/ensure-tables"
import {
  exchangeEmbeddedSignupCode,
  subscribeWabaToApp,
  registerPhoneNumber,
  verifyPhoneNumber,
} from "@/lib/whatsapp/meta-api"
import { createOrGetDataset } from "@/lib/meta-ads/api"
import { listOwnedCatalogs } from "@/lib/whatsapp/catalog-api"

/**
 * POST /api/meta/embedded-signup
 *
 * One popup, up to three channels. Finishes whichever WhatsApp Embedded
 * Signup flow the browser started (see embedded-signup-button.tsx), then —
 * using that SAME business token — best-effort discovers and connects a
 * granted Facebook Page (and its linked Instagram professional account, if
 * any) too. Which assets actually show up here depends entirely on what
 * the platform's Meta App Configuration was set up to request in Meta's
 * own dashboard (see meta-platform-config.tsx) — a WhatsApp-only
 * Configuration will simply find no Page to connect, which is not an
 * error, just nothing extra to do.
 *
 * Body: { code, wabaId, phoneNumberId } — `code` from FB.login's callback,
 * `wabaId`/`phoneNumberId` from the WA_EMBEDDED_SIGNUP postMessage event.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")

    const body = await req.json().catch(() => ({}))
    const { code, wabaId, phoneNumberId } = body as { code?: string; wabaId?: string; phoneNumberId?: string }
    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json({ error: "Missing code, wabaId, or phoneNumberId from the signup popup" }, { status: 400 })
    }

    const platformConfig = await loadMetaPlatformConfig()
    if (!platformConfig) {
      return NextResponse.json(
        { error: "Embedded Signup isn't set up on this platform yet — add the Meta App credentials first." },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      const result = await exchangeEmbeddedSignupCode({
        appId: platformConfig.appId,
        appSecret: platformConfig.appSecret,
        code,
      })
      accessToken = result.accessToken
    } catch (err) {
      console.error("[embedded-signup] code exchange failed:", err)
      const reason = err instanceof Error ? err.message : "Failed to exchange the signup code"
      return NextResponse.json({ error: `${reason} — the code expires 30 seconds after signup, try connecting again.` }, { status: 502 })
    }

    // ── WhatsApp ────────────────────────────────────────────────────
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
    } catch (err) {
      console.error("[embedded-signup] subscribe failed:", err)
      const reason = err instanceof Error ? err.message : "Failed to subscribe to the WhatsApp Business Account"
      return NextResponse.json({ error: reason }, { status: 502 })
    }

    // crypto.randomInt is uniform (unlike Math.random-based mod bias) —
    // same reasoning as the OTP generator in lib/auth/mfa.ts. Embedded
    // Signup never sends the tenant through WhatsApp Manager themselves,
    // so there's no pre-existing 2FA PIN to ask for — we set our own.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0")
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin })
    } catch (err) {
      console.error("[embedded-signup] register failed:", err)
      const reason = err instanceof Error ? err.message : "Failed to register the phone number"
      return NextResponse.json({ error: reason }, { status: 502 })
    }

    const phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken }).catch(() => null)

    const now = new Date()
    // Finding #14 — an account can have several connected numbers, so
    // this is no longer a plain upsert-by-account. A number already
    // connected to this account (re-running Quick Connect for the same
    // number) updates in place; a genuinely new number becomes a new
    // row, auto-defaulted only if it's the account's very first.
    const existingForThisNumber = await prisma.whatsAppConfig.findFirst({
      where: { account_id: ctx.accountId, phone_number_id: phoneNumberId },
      select: { id: true },
    })
    const accountHasAnyNumber = existingForThisNumber
      ? true
      : (await prisma.whatsAppConfig.count({ where: { account_id: ctx.accountId } })) > 0

    if (existingForThisNumber) {
      await prisma.whatsAppConfig.update({
        where: { id: existingForThisNumber.id },
        data: {
          waba_id: wabaId,
          access_token: encrypt(accessToken),
          status: "connected",
          registered_at: now,
          subscribed_apps_at: now,
          connected_at: now,
          last_registration_error: null,
          connect_method: "quick",
        },
      })
    } else {
      await prisma.whatsAppConfig.create({
        data: {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          access_token: encrypt(accessToken),
          status: "connected",
          registered_at: now,
          subscribed_apps_at: now,
          connected_at: now,
          connect_method: "quick",
          is_default: !accountHasAnyNumber,
        },
      })
    }

    // Facebook Page (→ Messenger) + Instagram, Meta Ads (ad account +
    // Conversions API dataset), and Product Catalog — three independent,
    // best-effort discovery passes (each writes its own table, none reads
    // what another wrote), run concurrently instead of one-after-another
    // so this user-facing "Connected!" response doesn't pay the sum of
    // three separate multi-call Graph API round trips (previously ~2-4s
    // of avoidable extra latency).
    const [social, ads, catalog] = await Promise.all([
      discoverAndSaveFacebookAndInstagram(ctx.accountId, accessToken),
      discoverAndSaveMetaAds(ctx.accountId, ctx.userId, accessToken, wabaId),
      discoverAndSaveCatalog(ctx.accountId, ctx.userId, accessToken),
    ])

    return NextResponse.json({
      success: true,
      phoneDisplay: phoneInfo?.display_phone_number ?? "",
      verifiedName: phoneInfo?.verified_name ?? "",
      ...social,
      ...ads,
      ...catalog,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

async function discoverAndSaveFacebookAndInstagram(accountId: string, businessToken: string) {
  const result = { facebookConnected: false, instagramConnected: false, pageName: "", igUsername: "" }
  try {
    const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${businessToken}`, { cache: "no-store" })
    const pagesData = (await pagesRes.json()) as { data?: Array<{ id: string; name: string; access_token: string }> }
    // The Configuration may not have requested Page access at all (a
    // WhatsApp-only setup) — an empty/missing list here just means there's
    // nothing to connect, not a failure.
    const page = pagesData.data?.[0]
    if (!page) return result

    await ensureFacebookConfigTable()
    await prisma.$executeRaw`
      INSERT INTO facebook_config (account_id, access_token, page_id, page_name, status, test_error, last_tested_at, updated_at)
      VALUES (${accountId}::uuid, ${page.access_token}, ${page.id}, ${page.name}, 'connected', null, now(), now())
      ON CONFLICT (account_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        page_id      = EXCLUDED.page_id,
        page_name    = EXCLUDED.page_name,
        status       = 'connected',
        test_error   = null,
        last_tested_at = now(),
        updated_at   = now()
    `
    result.facebookConnected = true
    result.pageName = page.name

    // An Instagram professional account is always linked through a Page in
    // Meta's data model — this is the standard, stable discovery call.
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,username,name}&access_token=${page.access_token}`,
      { cache: "no-store" },
    )
    const igData = (await igRes.json()) as { instagram_business_account?: { id: string; username?: string; name?: string } }
    const ig = igData.instagram_business_account
    if (ig?.id) {
      await ensureInstagramConfigTable()
      await prisma.$executeRaw`
        INSERT INTO instagram_config (account_id, access_token, instagram_account_id, page_id, ig_username, ig_name, status, test_error, last_tested_at, updated_at)
        VALUES (${accountId}::uuid, ${page.access_token}, ${ig.id}, ${page.id}, ${ig.username ?? null}, ${ig.name ?? null}, 'connected', null, now(), now())
        ON CONFLICT (account_id) DO UPDATE SET
          access_token         = EXCLUDED.access_token,
          instagram_account_id = EXCLUDED.instagram_account_id,
          page_id              = EXCLUDED.page_id,
          ig_username          = EXCLUDED.ig_username,
          ig_name              = EXCLUDED.ig_name,
          status               = 'connected',
          test_error           = null,
          last_tested_at       = now(),
          updated_at           = now()
      `
      result.instagramConnected = true
      result.igUsername = ig.username ?? ""
    }
  } catch (err) {
    // Best-effort by design — never let a Page/Instagram discovery hiccup
    // fail the WhatsApp connection that already succeeded above.
    console.error("[embedded-signup] Facebook/Instagram discovery skipped (non-fatal):", err)
  }
  return result
}

/**
 * Meta Ads' own "Quick Connect" — same one popup, same business token.
 * Whether this finds anything at all depends entirely on whether the
 * platform's Meta App Configuration was set up to request
 * ads_management/whatsapp_business_manage_events — exactly the same
 * best-effort shape as discoverAndSaveFacebookAndInstagram above. Finding
 * nothing here isn't an error; it just means Manual Connect (pasting a
 * System User token with those permissions) is the path for now.
 */
async function discoverAndSaveMetaAds(accountId: string, userId: string, businessToken: string, wabaId: string) {
  const result = { metaAdsConnected: false, adAccountName: "" }
  try {
    const adAccountsRes = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&access_token=${businessToken}`, { cache: "no-store" })
    const adAccountsData = (await adAccountsRes.json()) as { data?: Array<{ id: string; name: string }> }
    const adAccount = adAccountsData.data?.[0]

    // The dataset only needs whatsapp_business_manage_events, not
    // ads_management — worth trying independently of ad account access,
    // since Click-to-WhatsApp attribution can work even for a
    // Configuration that never granted ad account visibility at all.
    let datasetId: string | null = null
    try {
      const created = await createOrGetDataset({ wabaId, accessToken: businessToken })
      datasetId = created.datasetId
    } catch (err) {
      console.warn("[embedded-signup] Meta Ads dataset creation skipped (non-fatal):", err instanceof Error ? err.message : err)
    }

    // Nothing this Configuration actually granted — Manual Connect is
    // the path until the platform operator widens its permission set.
    if (!adAccount && !datasetId) return result

    const now = new Date()
    await prisma.metaAdsConfig.upsert({
      where: { account_id: accountId },
      create: {
        account_id: accountId,
        user_id: userId,
        waba_id: wabaId,
        ad_account_id: adAccount?.id ?? null,
        access_token: encrypt(businessToken),
        dataset_id: datasetId,
        status: "connected",
        connected_at: now,
        last_tested_at: now,
      },
      update: {
        waba_id: wabaId,
        ad_account_id: adAccount?.id ?? null,
        access_token: encrypt(businessToken),
        dataset_id: datasetId ?? undefined,
        status: "connected",
        last_tested_at: now,
      },
    })
    result.metaAdsConnected = true
    result.adAccountName = adAccount?.name ?? ""
  } catch (err) {
    console.error("[embedded-signup] Meta Ads discovery skipped (non-fatal):", err)
  }
  return result
}

/**
 * Product Catalog's own "Quick Connect" — same one popup, same business
 * token. Catalogs are owned by a Meta Business (not directly by "me" or a
 * WABA), so this first finds the business the token can manage, then lists
 * that business's catalogs. Auto-connects when there's exactly one; when
 * there are several, this best-effort pass connects none and leaves the
 * choice to Manual Connect in Settings > Catalog (same "nothing granted
 * yet, Manual Connect is the path" shape as the two functions above).
 */
async function discoverAndSaveCatalog(accountId: string, userId: string, businessToken: string) {
  const result = { catalogConnected: false, catalogName: "" }
  try {
    const businessesRes = await fetch(`https://graph.facebook.com/v21.0/me/businesses?fields=id,name`, {
      headers: { Authorization: `Bearer ${businessToken}` },
      cache: "no-store",
    })
    const businessesData = (await businessesRes.json()) as { data?: Array<{ id: string; name: string }> }
    const business = businessesData.data?.[0]
    if (!business) return result

    const catalogs = await listOwnedCatalogs({ businessId: business.id, accessToken: businessToken })
    if (catalogs.length !== 1) return result // 0 or ambiguous — Manual Connect decides
    const catalog = catalogs[0]

    const now = new Date()
    await prisma.catalogConfig.upsert({
      where: { account_id: accountId },
      create: {
        account_id: accountId,
        user_id: userId,
        catalog_id: catalog.id,
        business_id: business.id,
        access_token: encrypt(businessToken),
        status: "connected",
        connected_at: now,
        last_tested_at: now,
      },
      update: {
        catalog_id: catalog.id,
        business_id: business.id,
        access_token: encrypt(businessToken),
        status: "connected",
        last_tested_at: now,
      },
    })
    result.catalogConnected = true
    result.catalogName = catalog.name
  } catch (err) {
    console.error("[embedded-signup] Catalog discovery skipped (non-fatal):", err)
  }
  return result
}
