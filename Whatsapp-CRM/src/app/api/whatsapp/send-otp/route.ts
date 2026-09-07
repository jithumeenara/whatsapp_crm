import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { sendOtpToContact, NoOtpTemplateError } from '@/lib/whatsapp/send-otp'
import { NoWhatsAppConfigError } from '@/lib/whatsapp/resolve-config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/send-otp
 * Body: { conversation_id }
 *
 * Finding #08a — the "Direct Send for OTP/utility" want, delivered via
 * the proven template+COPY_CODE mechanism (works today, no Meta
 * approval needed) with an automatic upgrade path to the real Direct
 * Send beta once a tenant has that approval (see send-otp.ts).
 * Generates its own 6-digit code — crypto.randomInt is uniform (unlike
 * Math.random-based mod bias), same reasoning as mfa.ts's own generator.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const rl = checkRateLimit(`send-otp:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return rateLimitResponse(rl)

    const body = await request.json().catch(() => ({}))
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : undefined
    if (!conversationId) return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        account_id: ctx.accountId,
        ...(ctx.role === 'agent' ? { assigned_agent_id: ctx.userId } : {}),
      },
      select: { id: true, contact_id: true },
    })
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

    try {
      const result = await sendOtpToContact({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId: conversation.contact_id,
        conversationId: conversation.id,
        code,
      })
      return NextResponse.json({ success: true, whatsapp_message_id: result.whatsapp_message_id, code })
    } catch (err) {
      if (err instanceof NoOtpTemplateError || err instanceof NoWhatsAppConfigError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
