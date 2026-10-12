import { NextResponse } from 'next/server'
import { cleanVisitorText } from '@/lib/webchat/public-message'
import { visitorHistory } from '@/lib/webchat/history'
import { receiveVisitorMessage } from '@/lib/webchat/inbound'
import { WEBCHAT_LIMITS, ipKey, jsonError, limit, readJson, requireVisitor } from '@/lib/webchat/http'

/**
 * The visitor's conversation — public, called by the chat frame with the
 * session token as a bearer. No conversation id is ever taken from the
 * request: the session decides whose thread this is.
 *
 * GET  ?after=<ISO>  messages since then (or the latest 100), for a
 *                    window catching up after a dropped connection.
 * POST { text, client_id, reply? }  one message from the visitor.
 *      client_id is the window's own id for the message; sending the
 *      same one twice stores and answers it once.
 */

export const dynamic = 'force-dynamic'

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/

export async function GET(req: Request) {
  const session = await requireVisitor(req)
  if (session instanceof NextResponse) return session
  const limited = limit(`read:${session.id}`, WEBCHAT_LIMITS.readPerSession)
  if (limited) return limited

  const afterRaw = new URL(req.url).searchParams.get('after')
  const after = afterRaw ? new Date(afterRaw) : null
  const history = await visitorHistory(session, after && !Number.isNaN(after.getTime()) ? after : null)
  return NextResponse.json(history, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const session = await requireVisitor(req)
  if (session instanceof NextResponse) return session

  const limited =
    limit(`send:${session.id}`, WEBCHAT_LIMITS.sendPerSession) ??
    limit(`send-ip:${ipKey(req)}`, WEBCHAT_LIMITS.sendPerIp)
  if (limited) return limited

  const body = await readJson(req)
  if (!body) return jsonError(400, 'Bad request.')
  if (typeof body.client_id !== 'string' || !CLIENT_ID.test(body.client_id)) return jsonError(400, 'Bad request.')

  // A tapped chatbot button carries its id and the label the visitor saw;
  // the label is what is stored and shown, the id is what the chatbot
  // matches on — exactly as a WhatsApp button reply.
  let reply: { id: string; title: string } | undefined
  if (body.reply && typeof body.reply === 'object') {
    const { id, title } = body.reply as { id?: unknown; title?: unknown }
    if (typeof id !== 'string' || !id || id.length > 256) return jsonError(400, 'Bad request.')
    const cleanTitle = cleanVisitorText(title, 80)
    if (!cleanTitle) return jsonError(400, 'Bad request.')
    reply = { id, title: cleanTitle }
  }

  const text = reply ? reply.title : cleanVisitorText(body.text)
  if (!text) return jsonError(400, 'Type a message first (up to 2000 characters).')

  try {
    const result = await receiveVisitorMessage({ session, text, clientMessageId: body.client_id, reply })
    if (!result.ok) return jsonError(result.status, result.error)
    return NextResponse.json({ message: result.message, duplicate: result.duplicate }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[webchat] send failed:', err instanceof Error ? err.message : err)
    return jsonError(500, 'Your message could not be sent. Please try again.')
  }
}
