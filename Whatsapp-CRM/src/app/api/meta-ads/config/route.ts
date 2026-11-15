import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { createOrGetDataset } from '@/lib/meta-ads/api'
import { checkMetaAdsAccess, cleanAdAccountId, cleanWabaId } from '@/lib/meta-ads/access-check'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { adsReadGate } from '@/lib/meta-ads/access'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'

/**
 * GET /api/meta-ads/config
 * Mirrors /api/whatsapp/config's shape exactly: 200 for every non-auth
 * outcome so the settings UI can render inline state instead of a
 * toast-only error.
 */
export async function GET() {
  try {
    // Read-only status (no secrets in the response), but each call tests the
    // connection with Meta, so it needs the Ads page grant and is limited.
    // POST/DELETE below (which touch real credentials) require 'owner'.
    const ctx = await requireRole('viewer')
    const denied = adsReadGate(ctx, 'config')
    if (denied) return denied
    const accountId = ctx.accountId

    const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } })
    if (!config) {
      return NextResponse.json({ connected: false, reason: 'no_config', message: 'No Meta Ads configuration saved yet.' })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({
        connected: false,
        reason: 'token_corrupted',
        needs_reset: true,
        message: 'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Reset and re-save.',
      })
    }

    const safeConfig = {
      id: config.id,
      waba_id: config.waba_id,
      ad_account_id: config.ad_account_id,
      business_id: config.business_id,
      dataset_id: config.dataset_id,
      automatic_events_enabled: config.automatic_events_enabled,
      status: config.status,
      last_tested_at: config.last_tested_at,
      test_error: config.test_error,
      connected_at: config.connected_at,
    }

    const test = await checkMetaAdsAccess({ accessToken, adAccountId: cleanAdAccountId(config.ad_account_id), wabaId: cleanWabaId(config.waba_id) })
    return NextResponse.json({ connected: test.ok, config: safeConfig, message: test.blocking ?? test.message })
  } catch (error) {
    // requireRole() throws UnauthorizedError(401)/ForbiddenError(403) —
    // both carry their own `.status`; anything else is a real 500.
    const status = (error as { status?: number })?.status
    if (status === 401 || status === 403) return toErrorResponse(error)
    console.error('Error in Meta Ads config GET:', error)
    return NextResponse.json({ connected: false, reason: 'unknown', message: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/meta-ads/config — save/update, verifying credentials + creating the Conversions API dataset first. */
export async function POST(request: Request) {
  try {
    // Writes real credentials — 'owner' only, matching every other
    // credentials-bearing settings route (this one had no role floor at
    // all before the full-app audit).
    const ctx = await requireRole('owner')

    const rl = checkRateLimit(`meta-ads-config:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return NextResponse.json({ error: 'Too many attempts — wait a moment and try again.' }, { status: 429 })

    const accountId = ctx.accountId

    const body = await request.json()
    const { waba_id, ad_account_id, business_id, access_token, automatic_events_enabled } = body

    if (typeof access_token !== 'string' || !access_token.trim() || access_token.length > 1000) {
      return NextResponse.json({ error: 'Access token is required.' }, { status: 400 })
    }
    const token = access_token.trim()

    // Each id is checked on its own: a wrong one is named, never silently dropped.
    const adAccount = cleanAdAccountId(ad_account_id)
    if (ad_account_id && !adAccount) {
      return NextResponse.json({ error: 'The ad account ID should be digits only, like 3406716452946977 (or act_ and the digits).' }, { status: 400 })
    }
    const waba = cleanWabaId(waba_id)
    if (waba_id && !waba) {
      return NextResponse.json({ error: 'The WhatsApp Business Account ID should be digits only.' }, { status: 400 })
    }
    const business = cleanWabaId(business_id)
    if (business_id && !business) {
      return NextResponse.json({ error: 'The Business ID should be digits only.' }, { status: 400 })
    }

    const test = await checkMetaAdsAccess({ accessToken: token, adAccountId: adAccount, wabaId: waba })
    if (!test.ok) {
      return NextResponse.json({ error: test.blocking ?? 'Meta did not accept these details.' }, { status: 400 })
    }
    // Only a WhatsApp account Meta let us read is saved or used for the dataset.
    const wabaOk = !!waba && test.waba?.ok === true

    let datasetId: string | null = null
    let datasetError: string | null = null
    try {
      if (wabaOk && waba) {
        const result = await createOrGetDataset({ wabaId: waba, accessToken: token })
        datasetId = result.datasetId
      }
    } catch (err) {
      // Non-fatal — the connection itself is valid (test passed above);
      // the dataset can be retried later via the Test button. Most likely
      // cause: the access token doesn't yet have the ads-side permission
      // this Meta App's Configuration hasn't been granted.
      datasetError = err instanceof Error ? err.message : 'Unknown error creating dataset'
      console.warn('[meta-ads/config] dataset creation failed (non-fatal):', datasetError)
    }

    const existing = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } })

    const data = {
      // The column cannot be empty; '' means "no WhatsApp account saved".
      waba_id: wabaOk && waba ? waba : '',
      ad_account_id: adAccount,
      business_id: business,
      access_token: encrypt(token),
      dataset_id: datasetId ?? existing?.dataset_id ?? null,
      automatic_events_enabled: automatic_events_enabled === false ? false : true,
      status: 'connected',
      last_tested_at: new Date(),
      test_error: datasetError,
      connected_at: existing?.connected_at ?? new Date(),
    }

    if (existing) {
      await prisma.metaAdsConfig.update({ where: { account_id: accountId }, data })
    } else {
      await prisma.metaAdsConfig.create({ data: { account_id: accountId, user_id: ctx.userId, ...data } })
    }
    await auditConfigChange(auditCtx(request, ctx), 'config.integration_changed', {
      area: 'meta_ads',
      before: existing as unknown as Record<string, unknown> | null,
      after: { waba_id: data.waba_id, ad_account_id: data.ad_account_id, business_id: data.business_id, access_token: data.access_token, dataset_id: data.dataset_id, automatic_events_enabled: data.automatic_events_enabled, status: data.status },
      meta: { created: !existing },
    })

    return NextResponse.json({
      success: true,
      saved: true,
      message: datasetError
        ? `${test.message} The ads dataset could not be created yet: ${datasetError}`
        : test.message,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** DELETE /api/meta-ads/config — "Reset Configuration" recovery flow. */
export async function DELETE(request?: Request) {
  try {
    // Destroys real credentials — 'owner' only, same floor as POST above.
    const ctx = await requireRole('owner')
    const { accountId } = ctx

    try {
      await prisma.metaAdsConfig.delete({ where: { account_id: accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2025') return NextResponse.json({ success: true })
      throw err
    }
    await auditConfigChange(auditCtx(request ?? null, ctx), 'config.integration_changed', { area: 'meta_ads', fields: [], meta: { removed: true } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
