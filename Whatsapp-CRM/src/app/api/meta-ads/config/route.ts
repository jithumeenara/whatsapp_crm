import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { testMetaAdsConnection, createOrGetDataset } from '@/lib/meta-ads/api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  return profile?.account_id ?? null
}

/**
 * GET /api/meta-ads/config
 * Mirrors /api/whatsapp/config's shape exactly: 200 for every non-auth
 * outcome so the settings UI can render inline state instead of a
 * toast-only error.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' })
    }

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

    const test = await testMetaAdsConnection({ wabaId: config.waba_id, accessToken })
    return NextResponse.json({ connected: test.ok, config: safeConfig, message: test.message })
  } catch (error) {
    console.error('Error in Meta Ads config GET:', error)
    return NextResponse.json({ connected: false, reason: 'unknown', message: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/meta-ads/config — save/update, verifying credentials + creating the Conversions API dataset first. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = checkRateLimit(`meta-ads-config:${session.user.id}`, RATE_LIMITS.adminAction)
    if (!rl.success) return NextResponse.json({ error: 'Too many attempts — wait a moment and try again.' }, { status: 429 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    const body = await request.json()
    const { waba_id, ad_account_id, business_id, access_token, automatic_events_enabled } = body

    if (!waba_id || !access_token) {
      return NextResponse.json({ error: 'WhatsApp Business Account ID and Access Token are required.' }, { status: 400 })
    }

    const test = await testMetaAdsConnection({ wabaId: waba_id, accessToken: access_token })
    if (!test.ok) {
      return NextResponse.json({ error: `Meta rejected these credentials: ${test.message}` }, { status: 400 })
    }

    let datasetId: string | null = null
    let datasetError: string | null = null
    try {
      const result = await createOrGetDataset({ wabaId: waba_id, accessToken: access_token })
      datasetId = result.datasetId
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
      waba_id,
      ad_account_id: ad_account_id || null,
      business_id: business_id || null,
      access_token: encrypt(access_token),
      dataset_id: datasetId ?? existing?.dataset_id ?? null,
      automatic_events_enabled: automatic_events_enabled ?? true,
      status: 'connected',
      last_tested_at: new Date(),
      test_error: datasetError,
      connected_at: existing?.connected_at ?? new Date(),
    }

    if (existing) {
      await prisma.metaAdsConfig.update({ where: { account_id: accountId }, data })
    } else {
      await prisma.metaAdsConfig.create({ data: { account_id: accountId, user_id: session.user.id, ...data } })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      message: datasetError
        ? `Connected, but the ads dataset couldn't be created yet: ${datasetError}`
        : test.message,
    })
  } catch (error) {
    console.error('Error in Meta Ads config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/meta-ads/config — "Reset Configuration" recovery flow. */
export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    try {
      await prisma.metaAdsConfig.delete({ where: { account_id: accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2025') return NextResponse.json({ success: true })
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in Meta Ads config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
