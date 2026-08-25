import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { sendSmsText } from "@/lib/messaging/channels/sms"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  return profile?.account_id ?? null
}

/**
 * POST /api/sms/config/test-message
 *
 * Sends a real, provider-billed SMS to a number the user supplies, using
 * the account's already-saved SMS config — the concrete "does this whole
 * pipeline actually work end to end" check, distinct from
 * testSmsConnection (a credential-only probe with no message sent).
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimit(`sms-test-message:${session.user.id}`, RATE_LIMITS.smsTestMessage)
    if (!limit.success) return rateLimitResponse(limit)

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const to = typeof body?.to === "string" ? body.to.trim() : ""
    if (!to) return NextResponse.json({ error: "A phone number is required" }, { status: 400 })

    const config = await prisma.smsConfig.findUnique({ where: { account_id: accountId }, select: { id: true } })
    if (!config) return NextResponse.json({ error: "Save your SMS configuration before sending a test message." }, { status: 400 })

    try {
      const result = await sendSmsText({
        accountId,
        to,
        text: "This is a test message from your WhatsApp CRM — SMS is connected correctly.",
      })
      return NextResponse.json({ success: true, message: `Test SMS sent to ${to}.`, message_id: result.messageId || undefined })
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error"
      return NextResponse.json({ error: `Failed to send test SMS: ${reason}` }, { status: 502 })
    }
  } catch (error) {
    console.error("Error in SMS test-message POST:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
