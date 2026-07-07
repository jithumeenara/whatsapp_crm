import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const RAZORPAY_API = "https://api.razorpay.com/v1"

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")

    const body = (await req.json()) as {
      amount: number
      currency?: string
      receipt?: string
      notes?: Record<string, string>
      integration_id?: string
    }
    const { amount, currency = "INR", receipt, notes, integration_id } = body

    if (!amount || typeof amount !== "number") {
      return NextResponse.json({ error: "amount is required (in paise)" }, { status: 400 })
    }
    if (amount < 100) {
      return NextResponse.json({ error: "Minimum amount is 100 paise (₹1)" }, { status: 400 })
    }

    // ── Resolve credentials ────────────────────────────────────
    // Priority: integration DB record → .env fallback
    let keyId: string | undefined
    let keySecret: string | undefined

    if (integration_id) {
      const intg = await prisma.integration.findFirst({
        where: { id: integration_id, account_id: ctx.accountId },
      })
      if (!intg) {
        return NextResponse.json({ error: "Integration not found" }, { status: 404 })
      }
      if (intg.auth_type !== "basic") {
        return NextResponse.json(
          { error: `Integration auth type is '${intg.auth_type}' — Razorpay requires Basic Auth (Key ID = username, Key Secret = password)` },
          { status: 400 },
        )
      }
      const cfg = intg.auth_config as { username?: string; password?: string } | null
      keyId = cfg?.username
      keySecret = cfg?.password
      if (!keyId || !keySecret) {
        return NextResponse.json(
          { error: "Integration is missing Key ID or Key Secret — edit the integration and re-enter your Razorpay credentials" },
          { status: 400 },
        )
      }
    } else {
      // Fallback to env vars (for programmatic use)
      keyId = process.env.RAZORPAY_KEY_ID
      keySecret = process.env.RAZORPAY_KEY_SECRET
      if (!keyId || !keySecret) {
        return NextResponse.json(
          { error: "No integration_id provided and RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars not set" },
          { status: 500 },
        )
      }
    }

    const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`

    // ── Create order via Razorpay REST API ─────────────────────
    const rzpRes = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        currency,
        receipt: receipt ?? `rcpt_${Date.now()}`,
        notes: notes ?? {},
      }),
    })

    const rzpData = (await rzpRes.json()) as {
      id?: string
      amount?: number
      currency?: string
      error?: { code: string; description: string }
    }

    if (!rzpRes.ok) {
      const desc = rzpData.error?.description ?? `Razorpay error ${rzpRes.status}`
      console.error("[create-order] Razorpay API error:", rzpRes.status, desc)
      if (rzpRes.status === 401) {
        return NextResponse.json(
          { error: `Razorpay auth failed: ${desc} — check Key ID and Key Secret in the integration settings` },
          { status: 401 },
        )
      }
      return NextResponse.json({ error: `Razorpay: ${desc}` }, { status: rzpRes.status })
    }

    return NextResponse.json({
      order_id: rzpData.id,
      amount: rzpData.amount,
      currency: rzpData.currency,
      key_id: keyId,  // send back the key_id for the checkout modal
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
