import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { verifyPhoneNumber } from "@/lib/whatsapp/meta-api"
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils"

/**
 * GET /api/whatsapp/qr-code
 *
 * Returns a ready-to-render QR code (data URL) that, when scanned,
 * opens WhatsApp with this account's configured number and a
 * pre-filled "hi" message — the standard click-to-WhatsApp (wa.me)
 * pattern, generated server-side so the phone number lookup and
 * Meta access token never leave the server.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    const accountId = profile?.account_id ?? ""
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      )
    }

    const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: accountId } })
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp is not connected yet. Set it up in Settings → WhatsApp." },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)
    const phoneInfo = await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })

    const digits = sanitizePhoneForMeta(phoneInfo.display_phone_number)
    const waLink = `https://wa.me/${digits}?text=${encodeURIComponent("hi")}`
    const qrDataUrl = await QRCode.toDataURL(waLink, { margin: 1, width: 320 })

    return NextResponse.json({
      qrDataUrl,
      waLink,
      phoneDisplay: phoneInfo.display_phone_number,
    })
  } catch (error) {
    console.error("Error generating WhatsApp QR code:", error)
    const message = error instanceof Error ? error.message : "Failed to generate QR code"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
