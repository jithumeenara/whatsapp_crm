import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { saveSmsConfig, testSmsConnection } from "@/lib/messaging/channels/sms"
import { decrypt } from "@/lib/whatsapp/encryption"
import crypto from "crypto"

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  return profile?.account_id ?? null
}

/**
 * GET /api/sms/config
 * Mirrors /api/whatsapp/config's shape: 200 for every non-auth outcome so
 * the settings UI can render inline state instead of a toast-only error.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: "no_account", message: "Your profile is not linked to an account." })
    }

    const config = await prisma.smsConfig.findUnique({ where: { account_id: accountId } })
    if (!config) {
      return NextResponse.json({ connected: false, reason: "no_config", message: "No SMS configuration saved yet." })
    }

    let authKey: string
    try {
      authKey = decrypt(config.auth_key)
    } catch {
      return NextResponse.json({
        connected: false,
        reason: "token_corrupted",
        needs_reset: true,
        message: "The stored auth key can't be decrypted with the current ENCRYPTION_KEY. Reset and re-save.",
      })
    }

    const safeConfig = {
      id: config.id,
      provider: config.provider,
      sender_id: config.sender_id,
      route: config.route,
      dlt_entity_id: config.dlt_entity_id,
      webhook_secret: config.webhook_secret, // used to build the webhook URL client-side, not a login credential
      status: config.status,
    }

    const test = await testSmsConnection(authKey)
    return NextResponse.json({ connected: test.ok, config: safeConfig, message: test.message })
  } catch (error) {
    console.error("Error in SMS config GET:", error)
    return NextResponse.json({ connected: false, reason: "unknown", message: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/sms/config — save/update, verifying credentials first. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    const body = await request.json()
    const { auth_key, sender_id, route, dlt_entity_id, dlt_template_id } = body
    if (!auth_key) return NextResponse.json({ error: "auth_key is required" }, { status: 400 })

    const test = await testSmsConnection(auth_key)
    if (!test.ok) return NextResponse.json({ error: `MSG91 rejected the credentials: ${test.message}` }, { status: 400 })

    // MSG91's inbound webhook auth mechanism isn't confirmed against current
    // docs (flagged in the implementation plan) — a per-account secret
    // embedded in the webhook URL path (/api/sms/webhook/[secret]) works
    // regardless of whatever MSG91-native scheme turns out to exist, and
    // doubles as tenant resolution for the shared webhook endpoint.
    const existing = await prisma.smsConfig.findUnique({ where: { account_id: accountId }, select: { webhook_secret: true } })
    const webhookSecret = existing?.webhook_secret ?? crypto.randomBytes(24).toString("hex")

    await saveSmsConfig({
      accountId,
      userId: session.user.id,
      authKey: auth_key,
      senderId: sender_id,
      route,
      dltEntityId: dlt_entity_id,
      dltTemplateId: dlt_template_id,
    })
    if (!existing?.webhook_secret) {
      await prisma.smsConfig.update({ where: { account_id: accountId }, data: { webhook_secret: webhookSecret } })
    }

    return NextResponse.json({ success: true, saved: true, message: test.message, webhook_secret: webhookSecret })
  } catch (error) {
    console.error("Error in SMS config POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/sms/config — "Reset Configuration" recovery flow. */
export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    try {
      await prisma.smsConfig.delete({ where: { account_id: accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ success: true })
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in SMS config DELETE:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
