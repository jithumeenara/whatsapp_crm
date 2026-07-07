"use client"

import { useState, useCallback, useEffect, useRef } from "react"

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance
  }
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description?: string
  order_id: string
  prefill?: { name?: string; email?: string; contact?: string }
  notes?: Record<string, string>
  theme?: { color?: string }
  handler: (response: RazorpayResponse) => void
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open(): void
  on(event: string, handler: (response: { error: { description: string } }) => void): void
}

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export interface CheckoutButtonProps {
  amount: number
  currency?: string
  businessName?: string
  description?: string
  prefill?: { name?: string; email?: string; contact?: string }
  notes?: Record<string, string>
  onSuccess?: (data: { payment_id: string; order_id: string }) => void
  onFailure?: (reason: string) => void
  children?: (props: { onClick: () => void; loading: boolean }) => React.ReactNode
  label?: string
  className?: string
}

const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js"

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded
    if (typeof window !== "undefined" && window.Razorpay) { resolve(); return }
    // Script tag already injected — wait for it
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_JS}"]`)
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("Razorpay script failed to load")))
      return
    }
    const script = document.createElement("script")
    script.src = CHECKOUT_JS
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Razorpay script failed to load — check your internet connection"))
    document.head.appendChild(script)
  })
}

export function RazorpayCheckoutButton({
  amount,
  currency = "INR",
  businessName = "WhatsApp CRM",
  description,
  prefill,
  notes,
  onSuccess,
  onFailure,
  children,
  label = "Pay Now",
  className,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef(false)

  // Start loading the script as soon as this component mounts
  useEffect(() => {
    loadRazorpayScript()
      .then(() => { loadedRef.current = true })
      .catch(() => { /* will surface on click */ })
  }, [])

  const handlePay = useCallback(async () => {
    setLoading(true)
    try {
      // Ensure script is loaded (instant if already done, waits if still loading)
      await loadRazorpayScript()
      loadedRef.current = true

      // Step 1 — create Razorpay order on server
      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency, notes }),
      })
      const orderData = await orderRes.json()
      if (!orderRes.ok) throw new Error(orderData.error ?? "Failed to create order")
      if (!orderData.key_id) throw new Error("Missing Razorpay key — check server env vars")

      // Step 2 — open Razorpay modal (timeout after 2 min if modal never resolves)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Payment timed out — modal may be blocked")), 120000)
        const done = (fn: () => void) => { clearTimeout(timeout); fn() }

        const rzp = new window.Razorpay({
          key: orderData.key_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: businessName,
          description,
          order_id: orderData.order_id,
          prefill,
          notes,
          theme: { color: "#5B6CF9" },
          handler: async (response: RazorpayResponse) => {
            // Step 3 — verify signature on server
            try {
              const verifyRes = await fetch("/api/razorpay/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              })
              const verifyData = await verifyRes.json()
              if (!verifyRes.ok) { done(() => reject(new Error(verifyData.error ?? "Signature verification failed"))); return }
              onSuccess?.({ payment_id: response.razorpay_payment_id, order_id: response.razorpay_order_id })
              done(resolve)
            } catch {
              done(() => reject(new Error("Payment verification request failed")))
            }
          },
          modal: {
            ondismiss: () => {
              done(resolve)
              onFailure?.("Payment cancelled")
            },
          },
        })
        rzp.on("payment.failed", ((resp: { error: { description: string } }) => {
          done(() => reject(new Error(resp.error.description ?? "Payment failed")))
        }) as (r: unknown) => void)
        rzp.open()
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout error"
      if (msg !== "Payment cancelled") onFailure?.(msg)
    } finally {
      setLoading(false)
    }
  }, [amount, currency, businessName, description, prefill, notes, onSuccess, onFailure])

  if (children) return <>{children({ onClick: handlePay, loading })}</>

  return (
    <button
      type="button"
      onClick={handlePay}
      disabled={loading}
      className={className ?? "inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"}
    >
      {loading ? (
        <>
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
          Processing…
        </>
      ) : label}
    </button>
  )
}
