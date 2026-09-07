/**
 * Razorpay adapter for in-chat UPI payments (Finding #09) — the only
 * gateway of Meta's four (Razorpay/PayU/Billdesk/Zaakpay) this pass
 * wires up, since the audit's own research found this app already has a
 * live Razorpay relationship (see src/app/api/razorpay/* — currently
 * used for ad-hoc lead payment collection, unrelated to WhatsApp).
 * PayU/Billdesk/Zaakpay are selectable in the Settings UI but show
 * "adapter not yet built" — honest about what's actually wired versus
 * just schema-representable.
 *
 * Uses Razorpay's Payment Links API (a stable, well-documented REST
 * endpoint — not the same Orders API src/app/api/razorpay/create-order
 * already uses, which drives Razorpay's own checkout.js modal rather
 * than producing a shareable link/UPI intent suitable for a WhatsApp
 * message). Not live-tested against a real Razorpay account in this
 * pass — flagged honestly, same as every other piece of this feature
 * that depends on Meta's ungranted payments approval to actually try.
 */

import crypto from 'node:crypto'

const RAZORPAY_API = 'https://api.razorpay.com/v1'

export interface RazorpayCredentials {
  keyId: string
  keySecret: string
}

export interface CreatePaymentLinkArgs {
  credentials: RazorpayCredentials
  amount: number // in the currency's major unit (e.g. rupees, not paise)
  currency: string
  referenceId: string
  description: string
  customerPhone?: string
}

export interface PaymentLinkResult {
  paymentLinkId: string
  shortUrl: string
}

export async function createRazorpayPaymentLink(args: CreatePaymentLinkArgs): Promise<PaymentLinkResult> {
  const { credentials, amount, currency, referenceId, description, customerPhone } = args
  const auth = `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`

  const response = await fetch(`${RAZORPAY_API}/payment_links`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // Razorpay wants the smallest currency unit (paise)
      currency,
      reference_id: referenceId,
      description,
      ...(customerPhone ? { customer: { contact: customerPhone }, notify: { sms: false, whatsapp: false } } : {}),
      // whatsapp notify stays off — this app sends the link itself via
      // the order_details message, not Razorpay's own WhatsApp notify.
    }),
  })

  const data = (await response.json()) as { id?: string; short_url?: string; error?: { description?: string } }
  if (!response.ok || !data.id || !data.short_url) {
    throw new Error(data.error?.description || `Razorpay payment link creation failed: ${response.status}`)
  }
  return { paymentLinkId: data.id, shortUrl: data.short_url }
}

/** Verifies a Razorpay webhook signature (HMAC-SHA256 over the raw body
 *  with the webhook secret) — mirrors the verification already proven in
 *  src/app/api/razorpay/verify-payment/route.ts for the payment-link
 *  webhook flow instead of the checkout-modal flow. */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false // length mismatch etc. — definitely not equal
  }
}
