import { describe, expect, it, vi } from 'vitest'

/**
 * Bug: Razorpay delivers a webhook again whenever it is not sure the first
 * one arrived. Every delivery of "paid" re-marked the payment and sent the
 * customer "Payment received — thank you!" again. Twice is once.
 */

const h = vi.hoisted(() => ({
  payment: {
    id: 'p1', reference_id: 'ref-1', status: 'pending', whatsapp_config_id: 'w1', account_id: 'a1',
    conversation_id: 'c1', contact_id: 'k1', gateway_transaction_id: null as string | null,
  } as Record<string, unknown>,
  sent: 0,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/payment-gateways/razorpay', () => ({ verifyRazorpayWebhookSignature: () => true }))
vi.mock('@/lib/whatsapp/payments-api', () => ({
  sendOrderStatusMessage: async () => {
    h.sent++
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppPayment: {
      findUnique: async () => ({ ...h.payment }),
      update: async (a: { data: Record<string, unknown> }) => Object.assign(h.payment, a.data),
      updateMany: async (a: { where: { status?: { not?: string } }; data: Record<string, unknown> }) => {
        if (a.where.status?.not !== undefined && h.payment.status === a.where.status.not) return { count: 0 }
        Object.assign(h.payment, a.data)
        return { count: 1 }
      },
      findFirst: async () => ({ ...h.payment }),
    },
    paymentGatewayConfig: {
      findUnique: async () => ({ gateway: 'razorpay', credentials: JSON.stringify({ key_id: 'k', key_secret: 's' }) }),
    },
    whatsAppConfig: { findUnique: async () => ({ phone_number_id: 'pn', access_token: 't' }) },
    contact: { findUnique: async () => ({ phone: '919000000001' }) },
  },
}))

import { POST } from './route'

const paid = JSON.stringify({
  event: 'payment_link.paid',
  payload: { payment_link: { entity: { reference_id: 'ref-1', status: 'paid' } }, payment: { entity: { id: 'pay_X' } } },
})
const deliver = () => POST(new Request('http://x/api/whatsapp/payments/webhook', { method: 'POST', body: paid, headers: { 'x-razorpay-signature': 'sig' } }))

describe('Razorpay payment webhook', () => {
  it('the same "paid" delivered twice tells the customer once', async () => {
    expect((await deliver()).status).toBe(200)
    expect((await deliver()).status).toBe(200)
    await new Promise((r) => setTimeout(r, 20)) // the follow-up is sent after the reply
    expect(h.payment.status).toBe('completed')
    expect(h.sent).toBe(1)
  })
})
