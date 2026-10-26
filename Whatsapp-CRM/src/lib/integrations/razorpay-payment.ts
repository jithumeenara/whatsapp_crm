/**
 * The row saved for a Razorpay payment, built from what Razorpay itself
 * says about it.
 */

const UNIX_TS_RE = /^\d{10}$/
const DATE_KEYS = ["_at", "date", "time", "created", "updated", "captured"]

/** A Razorpay payment id — never a path that reaches another endpoint. */
export function isRazorpayPaymentId(id: unknown): id is string {
  return typeof id === "string" && /^pay_[A-Za-z0-9]{14}$/.test(id)
}

const PAID = new Set(["captured", "authorized"])

export type PaymentRowResult = { ok: true; row: Record<string, string> } | { ok: false; error: string }

export function paymentRowFromRazorpay(
  paymentId: string,
  apiOk: boolean,
  payData: Record<string, unknown>,
): PaymentRowResult {
  // Only what Razorpay confirms is saved: the browser's amount is never used.
  if (!apiOk) return { ok: false, error: "Razorpay does not know this payment." }
  if (payData.id !== paymentId) return { ok: false, error: "Razorpay returned a different payment." }
  if (!PAID.has(String(payData.status))) return { ok: false, error: "This payment is not completed." }
  const row: Record<string, string> = {}
  for (const [k, v] of Object.entries(payData)) {
    if (v === null || v === undefined || typeof v === "object") continue
    const str = String(v)
    // Convert Unix second-timestamps to ISO strings so date fields display correctly
    const isDateKey = DATE_KEYS.some((d) => k.toLowerCase().includes(d))
    if (isDateKey && UNIX_TS_RE.test(str)) {
      row[k] = new Date(parseInt(str) * 1000).toISOString()
    } else {
      row[k] = str
    }
  }
  // Also save notes as flat fields
  if (payData.notes && typeof payData.notes === "object") {
    for (const [k, v] of Object.entries(payData.notes as Record<string, unknown>)) {
      if (v !== null && v !== undefined && typeof v !== "object") {
        row[`note_${k}`] = String(v)
      }
    }
  }
  return { ok: true, row }
}
