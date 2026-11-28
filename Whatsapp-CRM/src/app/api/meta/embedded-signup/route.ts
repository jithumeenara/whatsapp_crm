import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/whatsapp/encryption"
import { loadMetaPlatformConfig } from "@/lib/whatsapp/meta-platform-config"
import {
  exchangeEmbeddedSignupCode,
  subscribeWabaToApp,
  verifyPhoneNumber,
  listWabaPhoneNumbers,
  listWabaPhoneNumberIds,
} from "@/lib/whatsapp/meta-api"
import { registerWithPin, savePin } from "@/lib/whatsapp/two-step-pin"
import { checkRateLimit } from "@/lib/rate-limit"
import { parseSignupBody } from "@/lib/meta/embedded-signup-body"
import { requestCoexistenceSync } from "@/lib/whatsapp/coexistence"
import { createOrGetDataset } from "@/lib/meta-ads/api"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"

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
 * A WhatsApp Business app number (event FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING,
 * "coexistence") sends { code, wabaId, coexistence: true } and no number.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")

    // A few tries a minute is plenty for a person in a Meta popup.
    if (!checkRateLimit(`embedded-signup:${ctx.userId}`, { limit: 10, windowMs: 60_000 }).success) {
      return NextResponse.json({ error: "Too many tries. Wait a minute and connect again." }, { status: 429 })
    }

    const parsed = parseSignupBody(await req.json().catch(() => null))
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { code, wabaId, coexistence } = parsed

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
      console.error("[embedded-signup] code exchange failed:", err instanceof Error ? err.message : err)
      return NextResponse.json({ error: "Meta did not accept the sign-in. It expires after a few minutes — connect again." }, { status: 502 })
    }

    // The ids come from the browser. Only a number this token can see under
    // that WABA is connected — nothing is subscribed, registered or saved
    // before that is proven. A WhatsApp Business app number (coexistence)
    // arrives with the WABA only; it is the WABA's number that is on the app.
    let numbers: Array<{ id: string; onBizApp: boolean }>
    try {
      numbers = coexistence
        ? await listWabaPhoneNumbers({ wabaId, accessToken })
        : (await listWabaPhoneNumberIds({ wabaId, accessToken })).map((id) => ({ id, onBizApp: false }))
    } catch (err) {
      console.error("[embedded-signup] could not list the WABA's numbers:", err instanceof Error ? err.message : err)
      return NextResponse.json({ error: "Could not confirm the WhatsApp account you chose. Try connecting again." }, { status: 403 })
    }
    let phoneNumberId: string
    if (parsed.coexistence) {
      const onApp = numbers.filter((n) => n.onBizApp)
      if (onApp.length !== 1) {
        return NextResponse.json({ error: "Could not find the WhatsApp Business app number in the account you granted. Try connecting again." }, { status: 403 })
      }
      phoneNumberId = onApp[0].id
    } else {
      phoneNumberId = parsed.phoneNumberId
      if (!numbers.some((n) => n.id === phoneNumberId)) {
        return NextResponse.json({ error: "That phone number is not part of the WhatsApp account you granted. Try connecting again." }, { status: 403 })
      }
    }

    // ── WhatsApp ────────────────────────────────────────────────────
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
    } catch (err) {
      console.error("[embedded-signup] subscribe failed:", err instanceof Error ? err.message : err)
      return NextResponse.json({ error: "Meta would not send this WhatsApp account's messages to the CRM. Try connecting again; if it keeps failing, check the app in Meta Business settings." }, { status: 502 })
    }

    // A WhatsApp Business app number is already registered (Meta: skip
    // registration for coexistence). Otherwise register with the PIN kept
    // from last time, or a new one if Meta has a PIN nobody kept.
    let pin: string | null = null
    if (!coexistence) {
      try {
        pin = await registerWithPin({ accountId: ctx.accountId, phoneNumberId, accessToken })
      } catch (err) {
        const reason = err instanceof Error ? err.message : ""
        console.error("[embedded-signup] register failed:", reason)
        const anotherApp = /another app|already in use|registered to another/i.test(reason)
        return NextResponse.json({
          error: anotherApp
            ? "This number is already connected to another WhatsApp service. Disconnect it there first, then connect again."
            : "Meta could not register this phone number. Try connecting again.",
        }, { status: 502 })
      }
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

    let savedConfigId: string
    if (existingForThisNumber) {
      savedConfigId = existingForThisNumber.id
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
          connect_method: coexistence ? "coexistence" : "quick",
        },
      })
    } else {
      const created = await prisma.whatsAppConfig.create({
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
          connect_method: coexistence ? "coexistence" : "quick",
          is_default: !accountHasAnyNumber,
        },
        select: { id: true },
      })
      savedConfigId = created.id
    }

    if (pin) await savePin(ctx.accountId, phoneNumberId, pin)

    // Coexistence: ask Meta for the phone's contacts and its chat history
    // now — allowed once, within 24 hours of onboarding.
    const sync = coexistence
      ? await requestCoexistenceSync({ configId: savedConfigId, accountId: ctx.accountId, phoneNumberId, accessToken })
      : null

    // Facebook Page (→ Messenger) + Instagram, Meta Ads (ad account +
    // Conversions API dataset), and Product Catalog — three independent,
    // best-effort discovery passes (each writes its own table, none reads
    // what another wrote), run concurrently instead of one-after-another
    // so this user-facing "Connected!" response doesn't pay the sum of
    // three separate multi-call Graph API round trips (previously ~2-4s
    // of avoidable extra latency).
    // WhatsApp only. Instagram, Messenger, ads and catalogs each have their
    // own Connect button (one asset type per Meta login); this flow no
    // longer guesses them (it used to take the first ad account and the
    // only catalog it could see). The WABA's Conversions API dataset stays
    // here: it belongs to the WhatsApp number.
    const dataset = await ensureWabaDataset(ctx.accountId, ctx.userId, accessToken, wabaId)

    // Which number was connected and what else came with it — ids only,
    // never the business token or the registration PIN.
    await auditConfigChange(auditCtx(req, ctx), "config.whatsapp_changed", {
      area: "whatsapp_embedded_signup",
      fields: ["access_token", "connect_method", "phone_number_id", "status", "waba_id"],
      target: { type: "whatsapp_number", id: phoneNumberId },
      meta: {
        verb: existingForThisNumber ? "reconnected" : "connected",
        coexistence,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
      },
    })

    return NextResponse.json({
      success: true,
      phoneDisplay: phoneInfo?.display_phone_number ?? "",
      verifiedName: phoneInfo?.verified_name ?? "",
      datasetReady: dataset.datasetReady,
      coexistence,
      historyRequested: sync?.requested ?? false,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}


/**
 * The WABA's Conversions API dataset (whatsapp_business_manage_events on
 * the WhatsApp token) so Click-to-WhatsApp outcomes can be reported. Never
 * picks an ad account — "Connect Ads" does that, and may hold several —
 * and never overwrites a token an ads connection saved.
 */
async function ensureWabaDataset(accountId: string, userId: string, businessToken: string, wabaId: string) {
  const result = { datasetReady: false }
  try {
    let datasetId: string | null = null
    try {
      datasetId = (await createOrGetDataset({ wabaId, accessToken: businessToken })).datasetId
    } catch (err) {
      console.warn("[embedded-signup] Conversions API dataset skipped (non-fatal):", err instanceof Error ? err.message : err)
    }
    if (!datasetId) return result
    const existing = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { ad_account_id: true } })
    if (existing) {
      // An ads connection owns the token when it chose an ad account.
      await prisma.metaAdsConfig.update({
        where: { account_id: accountId },
        data: existing.ad_account_id
          ? { waba_id: wabaId, dataset_id: datasetId }
          : { waba_id: wabaId, dataset_id: datasetId, access_token: encrypt(businessToken) },
      })
    } else {
      const now = new Date()
      await prisma.metaAdsConfig.create({
        data: {
          account_id: accountId, user_id: userId, waba_id: wabaId, ad_account_id: null,
          access_token: encrypt(businessToken), dataset_id: datasetId,
          status: "connected", connected_at: now, last_tested_at: now,
        },
      })
    }
    result.datasetReady = true
  } catch (err) {
    console.error("[embedded-signup] Conversions API dataset not saved (non-fatal):", err)
  }
  return result
}
