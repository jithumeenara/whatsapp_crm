import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { parsePhonePeCredentials, verifyPhonePeWebhookAuth } from '@/lib/payments/phonepe'
import { reconcilePhonePePayment } from '@/lib/payments/phonepe-reconcile'

/**
 * POST /api/payments/phonepe/webhook
 *
 * PhonePe telling us a payment link changed. One URL for every tenant,
 * configured in each tenant's own PhonePe dashboard; the payment — and
 * from it whose credentials to check against — is found from the
 * payload's merchantOrderId, which this app set to the payment's
 * reference_id when it created the link.
 *
 * A webhook here is a prompt, not a verdict. Its Authorization header
 * must match SHA256(username:password) for that tenant, and even then
 * nothing is marked paid from the body: reconcilePhonePePayment asks
 * PhonePe for the status with the tenant's own token and checks the
 * amount. So a forged call can at most cause one extra status check.
 *
 * Login-free (listed in src/proxy.ts) because PhonePe has no session.
 * POST is the only method exported: a public path answers every method it
 * defines, and nothing else is needed here.
 */

/** PhonePe's payload is a few hundred bytes; anything far larger is not
 *  PhonePe and is refused before it is parsed. */
const MAX_BODY_BYTES = 64 * 1024

/** This app's own reference format (`wa-` + a slice of a UUID). Checked
 *  before the database is asked anything. */
const REFERENCE_ID = /^wa-[A-Za-z0-9-]{1,60}$/

const LIMIT = { limit: 300, windowMs: 60_000 }

export async function POST(request: Request) {
  const limited = checkRateLimit(`phonepe-webhook:${clientIpKey(request.headers)}`, LIMIT)
  if (!limited.success) return rateLimitResponse(limited)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 })

  let body: { event?: unknown; payload?: { merchantOrderId?: unknown } }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const merchantOrderId = body?.payload?.merchantOrderId
  if (typeof merchantOrderId !== 'string' || !REFERENCE_ID.test(merchantOrderId)) {
    // Not one of ours. 200 so PhonePe does not keep retrying it.
    return NextResponse.json({ ignored: true })
  }

  try {
    const payment = await prisma.whatsAppPayment.findUnique({
      where: { reference_id: merchantOrderId },
      select: { id: true, whatsapp_config_id: true },
    })
    if (!payment) return NextResponse.json({ ignored: true })

    const gatewayConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { whatsapp_config_id: payment.whatsapp_config_id },
      select: { gateway: true, credentials: true },
    })
    if (!gatewayConfig || gatewayConfig.gateway !== 'phonepe') return NextResponse.json({ ignored: true })

    const credentials = parsePhonePeCredentials(decrypt(gatewayConfig.credentials as string))
    if (
      !credentials ||
      !verifyPhonePeWebhookAuth(request.headers.get('authorization'), credentials.webhookUsername, credentials.webhookPassword)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // PhonePe wants a 2xx within 3–5 seconds; the status call happens
    // after the answer. If it fails, the sweep asks again.
    void reconcilePhonePePayment(payment.id).catch((err) => {
      console.error('[phonepe/webhook] status check failed:', err instanceof Error ? err.message : err)
    })
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[phonepe/webhook]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
