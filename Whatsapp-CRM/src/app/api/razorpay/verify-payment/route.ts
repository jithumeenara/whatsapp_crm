import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")

    const body = (await req.json()) as {
      razorpay_order_id: string
      razorpay_payment_id: string
      razorpay_signature: string
      integration_id?: string
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, integration_id } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required" },
        { status: 400 },
      )
    }

    // Resolve key secret — integration DB record takes priority over env var
    let keySecret: string | undefined

    if (integration_id) {
      const intg = await prisma.integration.findFirst({
        where: { id: integration_id, account_id: ctx.accountId },
      })
      const cfg = intg?.auth_config as { username?: string; password?: string } | null
      keySecret = cfg?.password
      if (!keySecret) {
        return NextResponse.json(
          { error: "Integration missing Key Secret — re-enter Razorpay credentials in integration settings" },
          { status: 400 },
        )
      }
    } else {
      keySecret = process.env.RAZORPAY_KEY_SECRET
      if (!keySecret) {
        return NextResponse.json(
          { error: "RAZORPAY_KEY_SECRET env var not set — provide integration_id or add to .env" },
          { status: 500 },
        )
      }
    }

    const generated = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex")

    if (generated !== razorpay_signature) {
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 })
    }

    return NextResponse.json({
      verified: true,
      payment_id: razorpay_payment_id,
      order_id: razorpay_order_id,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
