import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { classifyMetaError } from '@/lib/whatsapp/meta-error-codes'

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  return profile?.account_id ?? null
}

type ConfigRow = {
  id: string
  user_id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
  verify_token: string | null
  status: string
  registered_at: Date | null
  subscribed_apps_at: Date | null
  connected_at: Date | null
  connect_method: string
  last_registration_error: string | null
  label: string | null
  is_default: boolean
  marketing_messages_status: string | null
  direct_send_enabled: boolean
}

const CONFIG_SELECT = {
  id: true, user_id: true, phone_number_id: true, waba_id: true,
  access_token: true, verify_token: true, status: true,
  registered_at: true, subscribed_apps_at: true, connected_at: true,
  connect_method: true, last_registration_error: true,
  label: true, is_default: true, marketing_messages_status: true, direct_send_enabled: true,
} as const

/** Builds one number's client-safe, Meta-verified shape — reused for
 *  every row in the list (Finding #14 — one account can now have
 *  several connected numbers, each rendered as its own health card). */
async function buildConfigSummary(config: ConfigRow, accountId: string) {
  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch (err) {
    console.error('[whatsapp/config GET] Token decryption failed:', err)
    return {
      id: config.id,
      connected: false,
      reason: 'token_corrupted',
      needs_reset: true,
      message:
        'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
    }
  }

  const connectedByProfile = await prisma.profile.findUnique({
    where: { user_id: config.user_id },
    select: { full_name: true, email: true },
  })

  const safeConfig = {
    id: config.id,
    user_id: config.user_id,
    phone_number_id: config.phone_number_id,
    waba_id: config.waba_id,
    status: config.status,
    registered_at: config.registered_at,
    subscribed_apps_at: config.subscribed_apps_at,
    connected_at: config.connected_at,
    connected_by: connectedByProfile?.full_name || connectedByProfile?.email || null,
    connect_method: config.connect_method,
    has_verify_token: !!config.verify_token,
    last_registration_error: config.last_registration_error,
    label: config.label,
    is_default: config.is_default,
    marketing_messages_status: config.marketing_messages_status,
    direct_send_enabled: config.direct_send_enabled,
  }

  try {
    const phoneInfo = await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })

    // Our OWN send counts, scoped to THIS number's conversations
    // (Finding #14 — used to be account-wide, which mixed multiple
    // numbers' volume together once an account could have more than one).
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const [sentLast24h, sentLast30d] = await Promise.all([
      prisma.message.count({
        where: {
          sender_type: { in: ['agent', 'bot'] },
          created_at: { gte: dayAgo },
          conversation: { account_id: accountId, whatsapp_config_id: config.id },
        },
      }),
      prisma.message.count({
        where: {
          sender_type: { in: ['agent', 'bot'] },
          created_at: { gte: monthAgo },
          conversation: { account_id: accountId, whatsapp_config_id: config.id },
        },
      }),
    ])

    return {
      id: config.id,
      connected: true,
      config: safeConfig,
      phone_info: phoneInfo,
      usage: { sentLast24h, sentLast30d },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('[whatsapp/config GET] Meta API verification failed:', message)
    const isTokenExpired = classifyMetaError(message).category === 'auth_expired'
    return {
      id: config.id,
      connected: false,
      config: safeConfig,
      reason: isTokenExpired ? 'token_expired' : 'meta_api_error',
      message: isTokenExpired
        ? 'Your WhatsApp access token has expired. Reconnect your account to keep sending messages.'
        : `Meta API rejected the credentials: ${message}`,
    }
  }
}

/**
 * GET /api/whatsapp/config
 *
 * Returns every connected number for the account (Finding #14 —
 * previously exactly one). Response shape:
 *   { connected: boolean, configs: [ { id, connected, config?, phone_info?, usage?, reason?, message? }, ... ] }
 * `connected` at the top level is true when at least one number is
 * healthy — the Settings UI still has an at-a-glance "is WhatsApp
 * working" signal even with several numbers, some possibly degraded.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const accountId = await resolveAccountId(userId)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.', configs: [] },
        { status: 200 },
      )
    }

    let configs: ConfigRow[]
    try {
      configs = await prisma.whatsAppConfig.findMany({
        where: { account_id: accountId },
        select: CONFIG_SELECT,
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      })
    } catch (err) {
      console.error('Error fetching whatsapp_config:', err)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration', configs: [] },
        { status: 200 }
      )
    }

    if (configs.length === 0) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
          configs: [],
        },
        { status: 200 }
      )
    }

    const summaries = await Promise.all(configs.map((c) => buildConfigSummary(c, accountId)))

    return NextResponse.json({
      connected: summaries.some((s) => s.connected),
      configs: summaries,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error', configs: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves a WhatsApp number for the authenticated account. Verifies
 * credentials with Meta first, then encrypts and stores.
 *
 * Body may include `id` to edit a specific already-connected number
 * (Finding #14); without it, a `phone_number_id` matching an existing
 * row for this account is treated as an edit-in-place (preserves the
 * pre-multi-number single-config UX), and anything else creates a NEW
 * number — the account's very first number automatically becomes its
 * default.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const accountId = await resolveAccountId(userId)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { id, phone_number_id, waba_id, access_token, verify_token, pin, label } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's lookup to throw on multiple
    // rows, silently dropping every inbound message. (Two ROWS under the
    // SAME account with different phone_number_ds is fine — that's the
    // whole point of Finding #14.)
    let claimed: { account_id: string } | null
    try {
      claimed = await prisma.whatsAppConfig.findFirst({
        where: {
          phone_number_id,
          NOT: { account_id: accountId },
        },
        select: { account_id: true },
      })
    } catch (err) {
      console.error('Error checking phone_number_id ownership:', err)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    // Resolve which existing row this save targets, if any: an explicit
    // `id`, else a match on phone_number_id for this account (edit-in-
    // place), else this is a brand-new number.
    const existing = id
      ? await prisma.whatsAppConfig.findFirst({
          where: { id, account_id: accountId },
          select: { id: true, registered_at: true, phone_number_id: true, connect_method: true, is_default: true },
        })
      : await prisma.whatsAppConfig.findFirst({
          where: { account_id: accountId, phone_number_id },
          select: { id: true, registered_at: true, phone_number_id: true, connect_method: true, is_default: true },
        })

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    // Step 1: register the phone number for inbound webhooks.
    let registeredAt: Date | null = existing?.registered_at ?? null
    let registrationError: string | null = null

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        return NextResponse.json(
          {
            error:
              'Two-step verification PIN is required to subscribe this number to wacrm. ' +
              'Set a 6-digit PIN in Meta WhatsApp Manager → Phone Numbers → Two-step verification, then paste it below.',
          },
          { status: 400 }
        )
      }
      try {
        await registerPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
          pin,
        })
        registeredAt = new Date()
      } catch (err) {
        registrationError =
          err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Phone number /register failed:', registrationError)
      }
    }

    // Step 2: subscribe the WABA to this app.
    let subscribedAppsAt: Date | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
      }
    }

    // Is this account's very first connected number? It becomes the
    // default automatically (Finding #14) — every other case leaves
    // is_default untouched (an existing default stays default when
    // just being edited; a newly-added second+ number starts non-default).
    const accountHasAnyConfig = existing
      ? true
      : (await prisma.whatsAppConfig.count({ where: { account_id: accountId } })) > 0

    // Persist everything in one shot.
    const baseData = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      // Preserve "quick" if this account was originally connected through
      // Embedded Signup and the user is just editing a field here — this
      // form is the "manual" path only the first time a config is created.
      connect_method: existing?.connect_method ?? 'manual',
      ...(typeof label === 'string' ? { label: label.trim() || null } : {}),
    }

    let savedId: string
    try {
      if (existing) {
        await prisma.whatsAppConfig.update({
          where: { id: existing.id },
          data: baseData,
        })
        savedId = existing.id
      } else {
        const created = await prisma.whatsAppConfig.create({
          data: {
            account_id: accountId,
            user_id: userId,
            is_default: !accountHasAnyConfig,
            ...baseData,
          },
        })
        savedId = created.id
      }
    } catch (err) {
      console.error('Error saving whatsapp_config:', err)
      return NextResponse.json(
        { error: existing ? 'Failed to update configuration' : 'Failed to save configuration' },
        { status: 500 }
      )
    }

    if (registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
        id: savedId,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: true,
      phone_info: phoneInfo,
      id: savedId,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config?id=<config_id>
 *
 * Removes one connected number (Finding #14 — `id` is now required when
 * an account has more than one; omitting it falls back to "the account's
 * sole number" for backward compatibility with any caller that predates
 * multi-number support). If the removed number was the default and other
 * numbers remain, the oldest remaining one becomes the new default.
 */
export async function DELETE(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const accountId = await resolveAccountId(userId)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { searchParams } = new URL(request.url)
    const requestedId = searchParams.get('id')

    const target = requestedId
      ? await prisma.whatsAppConfig.findFirst({ where: { id: requestedId, account_id: accountId } })
      : await prisma.whatsAppConfig.findFirst({ where: { account_id: accountId } })

    if (!target) {
      return NextResponse.json({ success: true }) // already gone
    }

    try {
      await prisma.whatsAppConfig.delete({ where: { id: target.id } })
    } catch (err) {
      console.error('Error deleting whatsapp_config:', err)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    if (target.is_default) {
      const nextDefault = await prisma.whatsAppConfig.findFirst({
        where: { account_id: accountId },
        orderBy: { created_at: 'asc' },
      })
      if (nextDefault) {
        await prisma.whatsAppConfig.update({ where: { id: nextDefault.id }, data: { is_default: true } })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
