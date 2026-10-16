import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { accountWhatsAppNumbers } from '@/lib/webchat/whatsapp-snapshot'

/**
 * GET /api/website-chat/whatsapp-numbers — this account's connected
 * WhatsApp numbers with the phone a visitor would message, for the
 * Website Bot's contact menu. Admin only; no tokens in the reply.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const numbers = await accountWhatsAppNumbers(ctx.accountId)
    return NextResponse.json({ numbers }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
