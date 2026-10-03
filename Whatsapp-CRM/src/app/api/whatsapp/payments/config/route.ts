import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  getPhonePeAccessToken,
  parsePhonePeCredentials,
  PhonePeError,
  type PhonePeCredentials,
} from '@/lib/payments/phonepe'

const BUILT_GATEWAYS = new Set(['razorpay', 'phonepe'])

/** Meta's four in-chat gateways, plus PhonePe — which Meta does not take
 *  in-chat, so it sends a payment link in an ordinary message instead
 *  (src/lib/payments/phonepe.ts). */
const GATEWAYS = ['razorpay', 'payu', 'billdesk', 'zaakpay', 'phonepe']

/**
 * GET /api/whatsapp/payments/config
 * Lists every connected number's payment gateway config (Finding #09) —
 * mirrors the shape of /api/whatsapp/config's list response. Never
 * returns raw credentials.
 */
export async function GET() {
  try {
    const ctx = await requireRole('owner')
    const rows = await prisma.paymentGatewayConfig.findMany({
      where: { account_id: ctx.accountId },
      select: {
        id: true, whatsapp_config_id: true, gateway: true, vpa: true, mcc: true, pc: true,
        status: true, created_at: true, updated_at: true, credentials: true,
      },
    })
    // Credentials never leave the server. For PhonePe the screen is told
    // only which environment the saved keys are for.
    const configs = rows.map(({ credentials, ...row }) => {
      if (row.gateway !== 'phonepe') return row
      const c = parsePhonePeCredentials(decrypt(credentials as string))
      return { ...row, environment: c?.environment ?? null }
    })
    const numbers = await prisma.whatsAppConfig.findMany({
      where: { account_id: ctx.accountId },
      select: { id: true, label: true, phone_number_id: true, is_default: true },
    })
    return NextResponse.json({ configs, numbers })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/whatsapp/payments/config
 * Body: { whatsapp_config_id, gateway, key_id?, key_secret?, vpa?, mcc?, pc? }
 * Connects (or edits) a payment gateway for one number. Always saves as
 * status "pending_meta_approval" — this can never verify Meta has
 * actually granted the WaBiz payments case, so it never claims
 * "Connected" the way Catalogs' config does.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const { whatsapp_config_id, gateway, key_id, key_secret, vpa, mcc, pc } = body as {
      whatsapp_config_id?: string
      gateway?: string
      key_id?: string
      key_secret?: string
      vpa?: string
      mcc?: string
      pc?: string
    }
    const phonepe = body as {
      client_id?: string
      client_secret?: string
      client_version?: string
      environment?: string
      webhook_username?: string
      webhook_password?: string
    }

    if (!whatsapp_config_id || !gateway) {
      return NextResponse.json({ error: 'whatsapp_config_id and gateway are required.' }, { status: 400 })
    }
    if (!GATEWAYS.includes(gateway)) {
      return NextResponse.json({ error: 'Unknown gateway.' }, { status: 400 })
    }

    const numberRow = await prisma.whatsAppConfig.findFirst({ where: { id: whatsapp_config_id, account_id: ctx.accountId } })
    if (!numberRow) return NextResponse.json({ error: 'Number not found.' }, { status: 404 })

    const existing = await prisma.paymentGatewayConfig.findUnique({ where: { whatsapp_config_id } })

    if (gateway === 'phonepe') {
      return savePhonePe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        whatsappConfigId: whatsapp_config_id,
        existing: existing?.gateway === 'phonepe' ? (existing.credentials as string) : null,
        hasRow: !!existing,
        input: phonepe,
      })
    }

    // Credentials are stored as a single encrypted string INSIDE the Json
    // column (a bare JSON string value, not an object) — encrypt() only
    // ever operates on one string, same convention as every other
    // encrypted-token field in this codebase; JSON.stringify the
    // {key_id, key_secret} pair first, encrypt that, store the result.
    // Saved keys are reused unless they were PhonePe's — a different shape,
    // which would read here as a key pair with nothing in it.
    const credentials: Prisma.InputJsonValue | undefined =
      key_id && key_secret
        ? encrypt(JSON.stringify({ key_id, key_secret }))
        : existing && existing.gateway !== 'phonepe'
          ? (existing.credentials as Prisma.InputJsonValue)
          : undefined

    if (!credentials) {
      return NextResponse.json({ error: 'key_id and key_secret are required for the first save.' }, { status: 400 })
    }

    const data = {
      gateway,
      credentials,
      vpa: vpa?.trim() || null,
      mcc: mcc?.trim() || null,
      pc: pc?.trim() || null,
      // Meta's in-chat gateways wait on Meta's approval whatever was here.
      status: 'pending_meta_approval',
    }

    if (existing) {
      await prisma.paymentGatewayConfig.update({ where: { whatsapp_config_id }, data })
    } else {
      await prisma.paymentGatewayConfig.create({
        data: { account_id: ctx.accountId, user_id: ctx.userId, whatsapp_config_id, ...data },
      })
    }

    return NextResponse.json({
      success: true,
      adapter_built: BUILT_GATEWAYS.has(gateway),
      message: BUILT_GATEWAYS.has(gateway)
        ? 'Saved. Still requires Meta to approve the WaBiz payments case for this number before any real send will work.'
        : `Saved, but no ${gateway} adapter is built yet — only Razorpay actually sends today.`,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PhonePe: client id, secret and version from PhonePe's dashboard
 * (Developer Settings), the environment they belong to, and the webhook's
 * username and password. A blank field on an edit keeps what is saved, so
 * a secret never has to be shown again to change something else.
 *
 * The keys are tried against PhonePe before anything is stored: a typo
 * shows up here, not as a failed payment request in front of a customer.
 * PhonePe needs no approval from Meta, so a saved PhonePe gateway is
 * active at once.
 */
async function savePhonePe(args: {
  accountId: string
  userId: string
  whatsappConfigId: string
  existing: string | null
  hasRow: boolean
  input: {
    client_id?: string
    client_secret?: string
    client_version?: string
    environment?: string
    webhook_username?: string
    webhook_password?: string
  }
}) {
  const saved = args.existing ? parsePhonePeCredentials(decrypt(args.existing)) : null
  const pick = (typed: string | undefined, kept: string | undefined) => (typed?.trim() ? typed.trim() : kept ?? '')
  const environment =
    args.input.environment === 'production' || args.input.environment === 'sandbox'
      ? args.input.environment
      : saved?.environment ?? 'sandbox'

  const credentials: PhonePeCredentials = {
    clientId: pick(args.input.client_id, saved?.clientId),
    clientSecret: pick(args.input.client_secret, saved?.clientSecret),
    clientVersion: pick(args.input.client_version, saved?.clientVersion),
    environment,
    webhookUsername: pick(args.input.webhook_username, saved?.webhookUsername),
    webhookPassword: pick(args.input.webhook_password, saved?.webhookPassword),
  }
  if (!credentials.clientId || !credentials.clientSecret || !credentials.clientVersion) {
    return NextResponse.json({ error: 'Client ID, Client Secret and Client Version are required.' }, { status: 400 })
  }
  if (!credentials.webhookUsername || !credentials.webhookPassword) {
    return NextResponse.json(
      { error: "The webhook username and password are required — the same ones you type in PhonePe's dashboard." },
      { status: 400 },
    )
  }
  if (credentials.webhookPassword.length < 12) {
    return NextResponse.json({ error: 'Use a webhook password of at least 12 characters.' }, { status: 400 })
  }

  try {
    await getPhonePeAccessToken(credentials)
  } catch (err) {
    const message = err instanceof PhonePeError ? err.message : 'Could not reach PhonePe.'
    return NextResponse.json({ error: `${message} Nothing was saved.` }, { status: 400 })
  }

  const data = {
    gateway: 'phonepe',
    credentials: encrypt(JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      client_version: credentials.clientVersion,
      environment: credentials.environment,
      webhook_username: credentials.webhookUsername,
      webhook_password: credentials.webhookPassword,
    })) as Prisma.InputJsonValue,
    vpa: null,
    mcc: null,
    pc: null,
    status: 'active',
  }
  if (args.hasRow) {
    await prisma.paymentGatewayConfig.update({ where: { whatsapp_config_id: args.whatsappConfigId }, data })
  } else {
    await prisma.paymentGatewayConfig.create({
      data: { account_id: args.accountId, user_id: args.userId, whatsapp_config_id: args.whatsappConfigId, ...data },
    })
  }

  return NextResponse.json({
    success: true,
    adapter_built: true,
    message:
      credentials.environment === 'sandbox'
        ? 'PhonePe connected (sandbox — test payments only). Payment requests from the Inbox now send a PhonePe link.'
        : 'PhonePe connected. Payment requests from the Inbox now send a PhonePe link.',
  })
}

/** DELETE /api/whatsapp/payments/config?whatsapp_config_id=... */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { searchParams } = new URL(request.url)
    const whatsappConfigId = searchParams.get('whatsapp_config_id')
    if (!whatsappConfigId) return NextResponse.json({ error: 'whatsapp_config_id is required.' }, { status: 400 })

    const existing = await prisma.paymentGatewayConfig.findFirst({ where: { whatsapp_config_id: whatsappConfigId, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ success: true })

    await prisma.paymentGatewayConfig.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
