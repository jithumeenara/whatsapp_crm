import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/whatsapp/encryption'

const BUILT_GATEWAYS = new Set(['razorpay'])

/**
 * GET /api/whatsapp/payments/config
 * Lists every connected number's payment gateway config (Finding #09) —
 * mirrors the shape of /api/whatsapp/config's list response. Never
 * returns raw credentials.
 */
export async function GET() {
  try {
    const ctx = await requireRole('owner')
    const configs = await prisma.paymentGatewayConfig.findMany({
      where: { account_id: ctx.accountId },
      select: {
        id: true, whatsapp_config_id: true, gateway: true, vpa: true, mcc: true, pc: true,
        status: true, created_at: true, updated_at: true,
      },
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

    if (!whatsapp_config_id || !gateway) {
      return NextResponse.json({ error: 'whatsapp_config_id and gateway are required.' }, { status: 400 })
    }
    if (!['razorpay', 'payu', 'billdesk', 'zaakpay'].includes(gateway)) {
      return NextResponse.json({ error: 'Unknown gateway.' }, { status: 400 })
    }

    const numberRow = await prisma.whatsAppConfig.findFirst({ where: { id: whatsapp_config_id, account_id: ctx.accountId } })
    if (!numberRow) return NextResponse.json({ error: 'Number not found.' }, { status: 404 })

    const existing = await prisma.paymentGatewayConfig.findUnique({ where: { whatsapp_config_id } })

    // Credentials are stored as a single encrypted string INSIDE the Json
    // column (a bare JSON string value, not an object) — encrypt() only
    // ever operates on one string, same convention as every other
    // encrypted-token field in this codebase; JSON.stringify the
    // {key_id, key_secret} pair first, encrypt that, store the result.
    const credentials: Prisma.InputJsonValue | undefined =
      key_id && key_secret
        ? encrypt(JSON.stringify({ key_id, key_secret }))
        : (existing?.credentials as Prisma.InputJsonValue | undefined)

    if (!credentials) {
      return NextResponse.json({ error: 'key_id and key_secret are required for the first save.' }, { status: 400 })
    }

    const data = {
      gateway,
      credentials,
      vpa: vpa?.trim() || null,
      mcc: mcc?.trim() || null,
      pc: pc?.trim() || null,
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
