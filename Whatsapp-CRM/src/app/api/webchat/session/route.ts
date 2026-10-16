import { NextResponse } from 'next/server'
import { isPublicKeyShape, hashIp } from '@/lib/webchat/tokens'
import { authenticateSession, createSession, loadEnabledWidget } from '@/lib/webchat/session'
import { publicWidget } from '@/lib/webchat/widget-config'
import { visitorHistory } from '@/lib/webchat/history'
import { WEBCHAT_LIMITS, ipKey, isFromOurFrame, jsonError, limit, readJson } from '@/lib/webchat/http'

/**
 * POST /api/webchat/session — public, called by the chat frame.
 *
 * Body: { key, token?, page_url? }
 *
 * Resumes the visitor's session when the frame still holds a valid token
 * for this same widget; otherwise starts a new one. Either way it returns
 * the token to use, the window's look, and the conversation so far.
 *
 * A token for a different widget is not resumed — even one of the same
 * business — so a visitor's thread never surfaces in a window it was not
 * written in.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!isFromOurFrame(req)) return jsonError(403, 'Not allowed from this website.')
  const body = await readJson(req)
  if (!body) return jsonError(400, 'Bad request.')

  const key = body.key
  if (!isPublicKeyShape(key)) return jsonError(404, 'Chat not found.')
  const widget = await loadEnabledWidget(key)
  if (!widget) return jsonError(404, 'This chat is switched off.')

  const existing = body.token ? await authenticateSession(body.token) : null
  if (existing && existing.widget_id === widget.id) {
    const history = await visitorHistory(existing)
    return NextResponse.json(
      { token: body.token, resumed: true, widget: publicWidget(widget), ...history },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // New sessions only are limited per address: resuming costs nothing,
  // and a reload must never lock a real visitor out of their own chat.
  const ip = ipKey(req)
  const limited = limit(`session:${ip}`, WEBCHAT_LIMITS.sessionPerIp)
  if (limited) return limited

  const pageUrl = typeof body.page_url === 'string' && /^https?:\/\//.test(body.page_url) ? body.page_url : null
  const { token, expiresAt } = await createSession({
    widget,
    ipHash: ip === 'unknown' ? null : hashIp(ip),
    userAgent: req.headers.get('user-agent'),
    pageUrl,
  })
  return NextResponse.json(
    {
      token,
      expires_at: expiresAt.toISOString(),
      resumed: false,
      widget: publicWidget(widget),
      messages: [],
      status: null,
      with_team: false,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
