import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { saveEmailConfig, testEmailConnection } from "@/lib/messaging/channels/email"
import { decrypt } from "@/lib/whatsapp/encryption"
import crypto from "crypto"

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  return profile?.account_id ?? null
}

/** GET /api/email/config — mirrors /api/whatsapp/config's 200-for-every-non-auth-outcome shape. */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: "no_account", message: "Your profile is not linked to an account." })
    }

    const config = await prisma.emailConfig.findUnique({ where: { account_id: accountId } })
    if (!config) {
      return NextResponse.json({ connected: false, reason: "no_config", message: "No email configuration saved yet." })
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.api_key)
    } catch {
      return NextResponse.json({
        connected: false,
        reason: "token_corrupted",
        needs_reset: true,
        message: "The stored API key can't be decrypted with the current ENCRYPTION_KEY. Reset and re-save.",
      })
    }

    const safeConfig = {
      id: config.id,
      provider: config.provider,
      from_email: config.from_email,
      from_name: config.from_name,
      inbound_parse_host: config.inbound_parse_host,
      inbound_secret: config.inbound_secret, // used to build the webhook URL client-side, not a login credential
      status: config.status,
    }

    const test = await testEmailConnection(apiKey)
    return NextResponse.json({ connected: test.ok, config: safeConfig, message: test.message })
  } catch (error) {
    console.error("Error in Email config GET:", error)
    return NextResponse.json({ connected: false, reason: "unknown", message: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/email/config — save/update, verifying credentials first. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    const body = await request.json()
    const { api_key, from_email, from_name, inbound_parse_host } = body
    if (!api_key || !from_email) {
      return NextResponse.json({ error: "api_key and from_email are required" }, { status: 400 })
    }

    const test = await testEmailConnection(api_key)
    if (!test.ok) return NextResponse.json({ error: `SendGrid rejected the credentials: ${test.message}` }, { status: 400 })

    // Generate the inbound-parse secret once, on first save — Inbound Parse
    // has no signature header, so this token embedded in the webhook URL
    // path is the substitute (see /api/email/webhook/[token]).
    const existing = await prisma.emailConfig.findUnique({ where: { account_id: accountId }, select: { inbound_secret: true } })
    const inboundSecret = existing?.inbound_secret ?? crypto.randomBytes(24).toString("hex")

    const saved = await saveEmailConfig({
      accountId,
      userId: session.user.id,
      apiKey: api_key,
      fromEmail: from_email,
      fromName: from_name,
      inboundParseHost: inbound_parse_host,
    })
    if (!existing?.inbound_secret) {
      await prisma.emailConfig.update({ where: { account_id: accountId }, data: { inbound_secret: inboundSecret } })
    }

    return NextResponse.json({ success: true, saved: true, message: test.message, inbound_secret: inboundSecret, config_id: saved.id })
  } catch (error) {
    console.error("Error in Email config POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/email/config — "Reset Configuration" recovery flow. */
export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    try {
      await prisma.emailConfig.delete({ where: { account_id: accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ success: true })
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in Email config DELETE:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
