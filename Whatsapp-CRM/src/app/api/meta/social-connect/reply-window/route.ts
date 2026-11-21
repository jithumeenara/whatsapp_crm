import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { humanAgentEnabled } from '@/lib/meta/social-messaging'

/**
 * GET /api/meta/social-connect/reply-window?channel=instagram|facebook
 *
 * How long the Inbox may let staff reply after the customer's last message:
 * 24 hours, or 7 days when the owner has turned on Human agent replies.
 * Read-only and returns one number, so any team member may ask. The send
 * route enforces the same rule on the server; this only keeps the composer
 * honest.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireRole('viewer')
    const raw = new URL(req.url).searchParams.get('channel')
    const channel = raw === 'instagram' || raw === 'facebook' ? raw : null
    if (!channel) return NextResponse.json({ error: 'channel must be instagram or facebook' }, { status: 400 })
    const human = await humanAgentEnabled(ctx.accountId, channel)
    return NextResponse.json({ hours: human ? 168 : 24 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
