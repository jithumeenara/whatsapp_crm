import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from '@/lib/whatsapp/resolve-config'
import { getPhoneWebhookRoute, sameEndpoint, setPhoneWebhookOverride, webhookUrlFor } from '@/lib/whatsapp/webhook-delivery'
import { publicOrigin } from '@/lib/email/microsoft/origin'

/**
 * POST /api/whatsapp/config/webhook-route   { whatsapp_config_id? }
 *
 * "Send this number's messages here." Sets Meta's phone-number-level
 * webhook address — the most specific of the three Meta consults — to
 * this site's own webhook, so the number's customer messages arrive here
 * even when the Meta app's main address belongs to another site sharing
 * the app, or a previous provider left its address on the account.
 *
 * Only this number is affected; the app's main address and every other
 * number are left alone. Meta verifies the new address with a GET before
 * accepting it, using a token only this server knows.
 *
 * Admins and owners only. The address is never taken from the request
 * body — it is this site's own https host name, or the call is refused.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(`wa-webhook-route:${ctx.userId}`, { limit: 5, windowMs: 60_000 })
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => ({}))) as { whatsapp_config_id?: unknown }
    const requestedId = typeof body.whatsapp_config_id === 'string' ? body.whatsapp_config_id : undefined

    let config
    try {
      config = await resolveWhatsAppConfig({ accountId: ctx.accountId, whatsappConfigId: requestedId })
    } catch (err) {
      if (err instanceof NoWhatsAppConfigError) return NextResponse.json({ error: 'No WhatsApp number is connected.' }, { status: 404 })
      throw err
    }

    const url = webhookUrlFor(publicOrigin(request))
    if (!url) {
      return NextResponse.json(
        { error: 'Open the CRM at its public https address (not localhost or an IP) and try again — Meta only sends to a public https address.' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({ error: 'The saved access token cannot be read. Reconnect the number.' }, { status: 409 })
    }

    // The token Meta will present when it checks the address. Reuse the
    // number's own; make one if it never had one.
    let verifyToken: string | null = null
    if (config.verify_token) {
      try {
        verifyToken = decrypt(config.verify_token)
      } catch {
        verifyToken = null
      }
    }
    if (!verifyToken) {
      verifyToken = crypto.randomBytes(24).toString('base64url')
      await prisma.whatsAppConfig.update({ where: { id: config.id }, data: { verify_token: encrypt(verifyToken) } })
    }

    try {
      // The WhatsApp account must be subscribed to the app before Meta
      // honours an address override. Idempotent.
      if (config.waba_id) await subscribeWabaToApp({ wabaId: config.waba_id, accessToken })
      await setPhoneWebhookOverride({ phoneNumberId: config.phone_number_id, accessToken, url, verifyToken })
    } catch (err) {
      // Meta's own words (e.g. it could not verify the address) are the
      // most useful thing to show; they carry no secrets.
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[whatsapp] webhook-route failed:', message)
      return NextResponse.json({ error: `Meta refused: ${message}` }, { status: 502 })
    }
    if (config.waba_id) {
      await prisma.whatsAppConfig.update({ where: { id: config.id }, data: { subscribed_apps_at: new Date() } })
    }
    console.info(`[whatsapp] account ${ctx.accountId} pointed number ${config.phone_number_id}'s webhooks at ${url}`)

    const route = await getPhoneWebhookRoute(config.phone_number_id, accessToken).catch(() => null)
    const confirmed = !!route?.phone_number && sameEndpoint(route.phone_number, url)
    return NextResponse.json({ success: true, url, confirmed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
