import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { saveRcsConfig, testRcsConnection } from "@/lib/messaging/channels/rcs"
import { decrypt } from "@/lib/whatsapp/encryption"

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  return profile?.account_id ?? null
}

/** GET /api/rcs/config — mirrors /api/whatsapp/config's 200-for-every-non-auth-outcome shape. */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: "no_account", message: "Your profile is not linked to an account." })
    }

    const config = await prisma.rcsConfig.findUnique({ where: { account_id: accountId } })
    if (!config) {
      return NextResponse.json({ connected: false, reason: "no_config", message: "No RCS configuration saved yet." })
    }

    let authToken: string
    try {
      authToken = decrypt(config.auth_token)
    } catch {
      return NextResponse.json({
        connected: false,
        reason: "token_corrupted",
        needs_reset: true,
        message: "The stored auth token can't be decrypted with the current ENCRYPTION_KEY. Reset and re-save.",
      })
    }

    const safeConfig = {
      id: config.id,
      provider: config.provider,
      account_sid: config.account_sid,
      messaging_service_sid: config.messaging_service_sid,
      rcs_agent_id: config.rcs_agent_id,
      from_number: config.from_number,
      status: config.status,
    }

    const test = await testRcsConnection(config.account_sid, authToken)
    return NextResponse.json({ connected: test.ok, config: safeConfig, message: test.message })
  } catch (error) {
    console.error("Error in RCS config GET:", error)
    return NextResponse.json({ connected: false, reason: "unknown", message: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/rcs/config — save/update, verifying credentials first. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    const body = await request.json()
    const { account_sid, auth_token, messaging_service_sid, from_number } = body
    if (!account_sid || !auth_token) {
      return NextResponse.json({ error: "account_sid and auth_token are required" }, { status: 400 })
    }
    if (!messaging_service_sid && !from_number) {
      return NextResponse.json({ error: "Either messaging_service_sid or from_number is required" }, { status: 400 })
    }

    const test = await testRcsConnection(account_sid, auth_token)
    if (!test.ok) return NextResponse.json({ error: `Twilio rejected the credentials: ${test.message}` }, { status: 400 })

    await saveRcsConfig({
      accountId,
      userId: session.user.id,
      accountSid: account_sid,
      authToken: auth_token,
      messagingServiceSid: messaging_service_sid,
      fromNumber: from_number,
    })

    return NextResponse.json({ success: true, saved: true, message: test.message })
  } catch (error) {
    console.error("Error in RCS config POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE /api/rcs/config — "Reset Configuration" recovery flow. */
export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    try {
      await prisma.rcsConfig.delete({ where: { account_id: accountId } })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ success: true })
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in RCS config DELETE:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
