import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyRazorpayWebhookSignature } from './razorpay'

/**
 * Hardening (security audit 2026-10): with an empty webhook secret the
 * HMAC key is "" — which anyone can compute — and a forged "paid" event
 * verified. An empty secret now fails closed.
 */
const body = JSON.stringify({ event: 'payment_link.paid' })
const sig = (secret: string) => crypto.createHmac('sha256', secret).update(body).digest('hex')

describe('Razorpay webhook signature', () => {
  it('fails closed when no secret is set', () => {
    expect(verifyRazorpayWebhookSignature(body, sig(''), '')).toBe(false)
  })
  it('accepts the right signature and refuses a wrong one', () => {
    expect(verifyRazorpayWebhookSignature(body, sig('s3cret'), 's3cret')).toBe(true)
    expect(verifyRazorpayWebhookSignature(body, sig('other'), 's3cret')).toBe(false)
    expect(verifyRazorpayWebhookSignature(body, '', 's3cret')).toBe(false)
  })
})
