import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import {
  getWhatsAppBusinessProfile,
  updateWhatsAppBusinessProfile,
  verifyPhoneNumber,
  WHATSAPP_BUSINESS_VERTICALS,
} from "@/lib/whatsapp/meta-api"

async function resolveConfig(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  if (!profile?.account_id) return { error: "Your profile is not linked to an account.", config: null }
  const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: profile.account_id } })
  if (!config) return { error: "WhatsApp is not connected yet. Set it up above first.", config: null }
  return { error: null, config }
}

/**
 * GET /api/whatsapp/profile — the "About/description/address/etc" business
 * profile, distinct from the connection config above it. Also returns the
 * live display name + number (read-only — Meta requires a manual review to
 * change the display name, there's no simple API call for it).
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { error, config } = await resolveConfig(session.user.id)
    if (error || !config) return NextResponse.json({ error }, { status: 400 })

    const accessToken = decrypt(config.access_token)
    const [businessProfile, phoneInfo] = await Promise.all([
      getWhatsAppBusinessProfile({ phoneNumberId: config.phone_number_id, accessToken }),
      verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken }),
    ])

    return NextResponse.json({
      profile: businessProfile,
      displayName: phoneInfo.verified_name ?? "",
      phoneDisplay: phoneInfo.display_phone_number ?? "",
      verticals: WHATSAPP_BUSINESS_VERTICALS,
    })
  } catch (err) {
    console.error("[whatsapp/profile GET]", err)
    const message = err instanceof Error ? err.message : "Failed to load business profile"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** PATCH /api/whatsapp/profile — body: { about?, description?, address?, email?, websites?, vertical? } */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { error, config } = await resolveConfig(session.user.id)
    if (error || !config) return NextResponse.json({ error }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const { about, description, address, email, websites, vertical } = body as {
      about?: string; description?: string; address?: string; email?: string
      websites?: string[]; vertical?: string
    }

    if (about && about.length > 139) {
      return NextResponse.json({ error: "About text must be 139 characters or fewer" }, { status: 400 })
    }
    if (description && description.length > 512) {
      return NextResponse.json({ error: "Description must be 512 characters or fewer" }, { status: 400 })
    }

    const accessToken = decrypt(config.access_token)
    await updateWhatsAppBusinessProfile({
      phoneNumberId: config.phone_number_id,
      accessToken,
      profile: { about, description, address, email, websites, vertical },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[whatsapp/profile PATCH]", err)
    const message = err instanceof Error ? err.message : "Failed to save business profile"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
