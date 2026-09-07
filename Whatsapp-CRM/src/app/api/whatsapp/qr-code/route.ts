import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { verifyPhoneNumber } from "@/lib/whatsapp/meta-api"
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils"
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from "@/lib/whatsapp/resolve-config"

/**
 * GET /api/whatsapp/qr-code
 *
 * Returns a ready-to-render QR code (data URL) that, when scanned,
 * opens WhatsApp with this account's configured number and a
 * pre-filled "hi" message — the standard click-to-WhatsApp (wa.me)
 * pattern, generated server-side so the phone number lookup and
 * Meta access token never leave the server.
 */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Which connected number's QR code to generate (Finding #14) —
    // optional; falls back to the account's default number.
    const requestedConfigId = new URL(request.url).searchParams.get("whatsapp_config_id") ?? undefined

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

    let config
    try {
      config = await resolveWhatsAppConfig({ accountId, whatsappConfigId: requestedConfigId })
    } catch (err) {
      if (err instanceof NoWhatsAppConfigError) {
        return NextResponse.json(
          { error: "WhatsApp is not connected yet. Set it up in Settings → WhatsApp." },
          { status: 400 },
        )
      }
      throw err
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
