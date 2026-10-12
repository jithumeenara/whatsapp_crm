import { NextResponse } from 'next/server'
import { requestHuman } from '@/lib/webchat/inbound'
import { WEBCHAT_LIMITS, jsonError, limit, requireVisitor } from '@/lib/webchat/http'

/**
 * POST /api/webchat/handoff — the visitor pressed "Talk to a person".
 * Public, bearer session token. Only when the widget offers the button.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireVisitor(req)
  if (session instanceof NextResponse) return session
  if (!session.widget.allow_handoff) return jsonError(403, 'Not available on this chat.')
  const limited = limit(`handoff:${session.id}`, WEBCHAT_LIMITS.handoffPerSession)
  if (limited) return limited
  try {
    await requestHuman(session)
    return NextResponse.json({ ok: true, status: 'pending', with_team: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[webchat] handoff failed:', err instanceof Error ? err.message : err)
    return jsonError(500, 'Could not reach the team just now. Please try again.')
  }
}
