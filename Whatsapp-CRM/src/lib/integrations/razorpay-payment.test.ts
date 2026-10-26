import { describe, expect, it } from 'vitest'
import { isRazorpayPaymentId, paymentRowFromRazorpay } from './razorpay-payment'

// Bug: /api/razorpay/save-payment filled id, amount and currency from the
// browser when Razorpay did not confirm the payment, so a made-up
// payment id with any amount was saved as a real payment (and fired the
// table's alerts and automations).
describe('paymentRowFromRazorpay', () => {
  const captured = { id: 'pay_ABCDEFGHIJKLMN', amount: 50000, currency: 'INR', status: 'captured', created_at: 1760000000 }

  it('saves a payment Razorpay confirms as captured, with Razorpay\'s own amount', () => {
    const r = paymentRowFromRazorpay('pay_ABCDEFGHIJKLMN', true, captured)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.amount).toBe('50000')
      expect(r.row.currency).toBe('INR')
    }
  })

  it('refuses when Razorpay does not know the payment — never uses the browser\'s amount', () => {
    const r = paymentRowFromRazorpay('pay_FAKEFAKEFAKE00', false, { error: { code: 'BAD_REQUEST_ERROR' } })
    expect(r.ok).toBe(false)
  })

  it('refuses a payment that is not captured or authorized', () => {
    const r = paymentRowFromRazorpay('pay_ABCDEFGHIJKLMN', true, { ...captured, status: 'failed' })
    expect(r.ok).toBe(false)
  })

  it('refuses when Razorpay answers about a different payment', () => {
    const r = paymentRowFromRazorpay('pay_ABCDEFGHIJKLMN', true, { ...captured, id: 'pay_ZZZZZZZZZZZZZZ' })
    expect(r.ok).toBe(false)
  })
})

describe('isRazorpayPaymentId', () => {
  it('accepts only a real-looking payment id, never a path', () => {
    expect(isRazorpayPaymentId('pay_ABCDEFGHIJKLMN')).toBe(true)
    expect(isRazorpayPaymentId('../orders')).toBe(false)
    expect(isRazorpayPaymentId('pay_ABC/../../orders')).toBe(false)
    expect(isRazorpayPaymentId(42)).toBe(false)
  })
})
