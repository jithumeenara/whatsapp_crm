/**
 * In-chat UPI payments (Finding #09) — order_details/order_status
 * interactive messages, plus the UPI Intent deep-link shape. Built
 * against Meta's documented request/response shape for the SEND side
 * (confirmed during research); the exact PAYLOAD shape of Meta's
 * payment-status WEBHOOK event was not fully retrievable during that
 * research pass — the webhook branch in the main webhook route is built
 * defensively and flagged honestly rather than guessed, per this
 * codebase's practice of never presenting an unverified integration as
 * proven. Gated end-to-end on a manual Meta support-case approval no
 * API call here can grant — see PaymentGatewayConfig's schema comment.
 */
const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; error_subcode?: number }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    const e = data.error
    if (e) {
      const detail = e.message || fallback
      const code = e.code ? ` (code ${e.code}${e.error_subcode ? `.${e.error_subcode}` : ''})` : ''
      message = `${detail}${code}`
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface OrderDetailsItem {
  retailerId: string
  name: string
  amount: number // in the smallest currency unit is NOT required here — Meta takes a decimal string per item, matching order_details' documented shape
  quantity: number
}

export interface SendOrderDetailsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  referenceId: string
  items: OrderDetailsItem[]
  currency: string
  totalAmount: number
  /** The UPI intent link (upi://pay?...) or a payment-gateway checkout link. */
  paymentLink: string
  bodyText?: string
  contextMessageId?: string
}

/**
 * Sends the order_details message — acts as the in-chat invoice. Status
 * is always "pending" per Meta's spec (the customer hasn't paid yet);
 * `order_status` follow-ups (below) update it after the fact.
 */
export async function sendOrderDetailsMessage(args: SendOrderDetailsArgs): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, referenceId, items, currency, totalAmount, paymentLink, bodyText, contextMessageId } = args
  if (!referenceId) throw new Error('sendOrderDetailsMessage requires referenceId.')
  if (items.length === 0) throw new Error('sendOrderDetailsMessage requires at least one item.')

  const interactive: Record<string, unknown> = {
    type: 'order_details',
    body: { text: bodyText || 'Please review and complete your payment.' },
    action: {
      name: 'review_and_pay',
      parameters: {
        reference_id: referenceId,
        type: 'digital-goods',
        payment_type: 'upi',
        payment_configuration: 'default',
        currency,
        total_amount: { value: Math.round(totalAmount * 100), offset: 100 },
        order: {
          status: 'pending',
          items: items.map((it) => ({
            retailer_id: it.retailerId,
            name: it.name,
            amount: { value: Math.round(it.amount * 100), offset: 100 },
            quantity: it.quantity,
          })),
        },
        payment_link: paymentLink,
      },
    },
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface SendOrderStatusArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  referenceId: string
  status: 'processing' | 'shipped' | 'completed' | 'canceled'
  description?: string
  contextMessageId?: string
}

/** Sends a follow-up updating the customer on fulfillment/payment progress. */
export async function sendOrderStatusMessage(args: SendOrderStatusArgs): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, referenceId, status, description, contextMessageId } = args
  if (!referenceId) throw new Error('sendOrderStatusMessage requires referenceId.')

  const interactive: Record<string, unknown> = {
    type: 'order_status',
    body: { text: description || `Your order is now ${status}.` },
    action: {
      name: 'review_order',
      parameters: {
        reference_id: referenceId,
        order: { status },
      },
    },
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

/**
 * Builds a UPI Intent deep link directly (confirmed shape from research):
 * `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tr=<ref>`. The actual
 * mint/track step through a payment gateway (Razorpay etc.) is
 * gateway-specific — see payment-gateways/razorpay.ts.
 */
export function buildUpiIntentLink(args: {
  vpa: string
  payeeName: string
  amount: number
  referenceId: string
  currency?: string
}): string {
  const { vpa, payeeName, amount, referenceId, currency = 'INR' } = args
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: currency,
    tr: referenceId,
  })
  return `upi://pay?${params.toString()}`
}
