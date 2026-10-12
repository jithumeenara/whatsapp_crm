/**
 * Live delivery to website visitors.
 *
 * A socket.io namespace of its own, on the server the Inbox already uses —
 * no new service to run. Separate from the staff namespace on purpose:
 * a visitor's socket is admitted by a visitor session and can only ever
 * be in that session's rooms, so there is no message a visitor could send
 * that puts them in an account room. (The staff namespace has its own
 * check — see src/lib/realtime-ticket.ts.)
 *
 * Rooms:
 *   wsess:<session id>       every tab of one visitor
 *   wconv:<conversation id>  everybody looking at one conversation, which
 *                            is how an agent's reply finds the visitor
 *
 * Imported by server.ts, so no next/server here or in anything below.
 */

import type { Server as SocketIOServer, Namespace } from 'socket.io'
import { clientIpKey } from '@/lib/net/client-ip'
import { authenticateSession } from './session'
import type { VisitorMessage } from './public-message'

export const WEBCHAT_NAMESPACE = '/webchat'

/** Connection attempts per IP per minute — a reconnecting tab needs a
 *  handful; a script guessing tokens needs thousands. */
const CONNECTS_PER_MINUTE = 30
const attempts = new Map<string, { count: number; reset: number }>()

function allowConnect(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.reset <= now) {
    attempts.set(ip, { count: 1, reset: now + 60_000 })
    if (attempts.size > 10_000) {
      for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key)
    }
    return true
  }
  entry.count += 1
  return entry.count <= CONNECTS_PER_MINUTE
}

function namespace(): Namespace | null {
  const io = (global as unknown as { io?: SocketIOServer }).io
  return io ? io.of(WEBCHAT_NAMESPACE) : null
}

export function attachWebChatNamespace(io: SocketIOServer): void {
  const nsp = io.of(WEBCHAT_NAMESPACE)

  nsp.use((socket, next) => {
    const headers = socket.handshake.headers
    const ip = clientIpKey({
      get: (name) => {
        const value = headers[name.toLowerCase()]
        return typeof value === 'string' ? value : null
      },
    })
    if (!allowConnect(ip)) return next(new Error('rate_limited'))

    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token
    authenticateSession(token)
      .then((session) => {
        if (!session) return next(new Error('unauthorized'))
        socket.data.sessionId = session.id
        socket.data.conversationId = session.conversation_id
        next()
      })
      .catch(() => next(new Error('unavailable')))
  })

  nsp.on('connection', (socket) => {
    const sessionId = socket.data.sessionId as string
    const conversationId = socket.data.conversationId as string | null
    socket.join(`wsess:${sessionId}`)
    if (conversationId) socket.join(`wconv:${conversationId}`)
    // Visitors only listen. Anything they send goes through the HTTP
    // routes, where it is validated, limited and stored — so the socket
    // accepts no events at all.
  })
}

/** A conversation now exists for this session: its open sockets start
 *  receiving the conversation's messages. */
export function joinConversationRoom(sessionId: string, conversationId: string): void {
  namespace()?.in(`wsess:${sessionId}`).socketsJoin(`wconv:${conversationId}`)
}

export function pushVisitorMessage(conversationId: string, message: VisitorMessage): void {
  namespace()?.to(`wconv:${conversationId}`).emit('message', message)
}

export function pushVisitorTyping(conversationId: string, typing: boolean): void {
  namespace()?.to(`wconv:${conversationId}`).emit('typing', { typing })
}

/** Open / pending / closed, and whether a person has the conversation —
 *  so the window can say "connecting you to the team" honestly. */
export function pushVisitorStatus(conversationId: string, status: { status: string; with_team: boolean }): void {
  namespace()?.to(`wconv:${conversationId}`).emit('status', status)
}
