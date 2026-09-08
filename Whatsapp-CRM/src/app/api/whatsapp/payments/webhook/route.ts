import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyRazorpayWebhookSignature } from '@/lib/whatsapp/payment-gateways/razorpay'
import { sendOrderStatusMessage } from '@/lib/whatsapp/payments-api'
import { emitToAccount } from '@/lib/socket'

/**
 * POST /api/whatsapp/payments/webhook
 *
 * Razorpay's own webhook (Finding #09) — the reliable, verifiable side of
 * this integration, unlike Meta's payment-status webhook event whose
 * exact payload shape this session's research could not fully confirm
 * (stated honestly rather than guessed — see payments-api.ts's header
 * comment). Razorpay posts here when a payment_link's payment completes;
 * this updates the matching WhatsAppPayment row and sends the customer
 * an order_status follow-up.
 *
 * One shared URL across every tenant (Razorpay webhooks are configured
 * account-wide in each tenant's own Razorpay Dashboard — there's no
 * per-payment-link or per-account webhook URL Razorpay supports, so a
 * `?ref=` query param has nothing to be populated from and was never
 * wired anywhere; found and fixed in the full-app audit). Instead: every
 * Razorpay webhook payload for a payment link echoes back whatever
 * `reference_id` was set at link-creation time
 * (payload.payment_link.entity.reference_id) — this app already sets
 * that to WhatsAppPayment.reference_id (a unique, randomUUID-derived
 * value) when creating the link, so the payment — and from it, which
 * tenant's gateway credentials to verify the signature with — is looked
 * up directly from the payload itself. The lookup happens before
 * signature verification (the payload is otherwise untrusted at that
 * point), but nothing is acted on until the signature check against that
 * specific tenant's own webhook secret passes — a forged payload naming
 * a real reference_id still can't get past that without knowing the
 * matching tenant's secret.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''

  let event: {
    event?: string
    payload?: {
      payment_link?: { entity?: { reference_id?: string; status?: string } }
      payment?: { entity?: { id?: string } }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const referenceId = event.payload?.payment_link?.entity?.reference_id
  if (!referenceId) {
    return NextResponse.json({ error: 'No payment_link.reference_id in payload' }, { status: 400 })
  }

  try {
    const payment = await prisma.whatsAppPayment.findUnique({ where: { reference_id: referenceId } })
    if (!payment) return NextResponse.json({ error: 'Unknown payment reference' }, { status: 404 })

    const gatewayConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { whatsapp_config_id: payment.whatsapp_config_id },
    })
    if (!gatewayConfig || gatewayConfig.gateway !== 'razorpay') {
      return NextResponse.json({ error: 'No matching Razorpay gateway config' }, { status: 404 })
    }

    const { key_secret: keySecret } = JSON.parse(decrypt(gatewayConfig.credentials as string)) as { key_id: string; key_secret: string }
    if (!verifyRazorpayWebhookSignature(rawBody, signature, keySecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const linkStatus = event.payload?.payment_link?.entity?.status // 'paid' | 'expired' | 'cancelled', per Razorpay's documented values
    const gatewayTxnId = event.payload?.payment?.entity?.id

    const newStatus = linkStatus === 'paid' ? 'completed' : linkStatus === 'expired' || linkStatus === 'cancelled' ? 'failed' : payment.status

    const updated = await prisma.whatsAppPayment.update({
      where: { id: payment.id },
      data: { status: newStatus, gateway_transaction_id: gatewayTxnId ?? payment.gateway_transaction_id, raw_payload: event as unknown as object },
    })

    emitToAccount(payment.account_id, 'whatsapp_payment', { eventType: 'UPDATE', new: updated, old: {} })

    // Best-effort — let the customer know via an order_status follow-up.
    // Never blocks the webhook ack, matching every other fire-and-forget
    // pattern in this codebase.
    if (newStatus === 'completed' && payment.conversation_id) {
      void (async () => {
        try {
          const [config, contact] = await Promise.all([
            prisma.whatsAppConfig.findUnique({ where: { id: payment.whatsapp_config_id } }),
            payment.contact_id ? prisma.contact.findUnique({ where: { id: payment.contact_id }, select: { phone: true } }) : null,
          ])
          if (!config || !contact?.phone) return
          await sendOrderStatusMessage({
            phoneNumberId: config.phone_number_id,
            accessToken: decrypt(config.access_token),
            to: contact.phone,
            referenceId: payment.reference_id,
            status: 'completed',
            description: 'Payment received — thank you!',
          })
        } catch (err) {
          console.error('[payments/webhook] order_status follow-up failed:', err)
        }
      })()
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[payments/webhook] failed:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
