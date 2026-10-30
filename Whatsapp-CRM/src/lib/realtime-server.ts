/**
 * The staff namespace of the socket server: who gets in, which room they
 * are put in, and how long they may stay.
 *
 * ── Admission ───────────────────────────────────────────────────────
 *
 * Every connection presents a signed ticket from /api/realtime/ticket
 * and is placed in the one account room the ticket names. It used to
 * join whichever room it asked for, which let anyone holding an account
 * id listen to that business's messages — see realtime-ticket.ts.
 *
 * ── Why a connection has a lifetime ─────────────────────────────────
 *
 * The ticket is checked once, at the handshake, and a WebSocket can stay
 * open for days. So a member an admin removed, a device logged out from
 * Settings → Sessions, a session past its idle limit — each kept
 * receiving every new message of the account for as long as that tab
 * stayed open. Nothing on the socket ever asked again.
 *
 * Now each connection is closed after a bounded time and the browser
 * reconnects, which means asking /api/realtime/ticket for a new ticket —
 * an ordinary authenticated request that the proxy and requireRole judge
 * afresh. A session that is still good notices nothing (one reconnect,
 * no missed state: the page refetches on reconnect anyway); one that is
 * not gets no ticket and stays out. The lifetime is jittered so a
 * restart's worth of tabs do not all come back in the same second.
 *
 * For a removal that should not wait out the lifetime, each connection
 * also sits in a per-user room, and {@link disconnectUserSockets} closes
 * every connection that user has, immediately.
 *
 * Imported by server.ts (run by tsx, outside the "@/..." alias), so
 * relative imports only and nothing from next/server.
 */

import type { Server as SocketIOServer } from 'socket.io'
import { verifyRealtimeTicket } from './realtime-ticket'

/** Longest a staff connection stays open before it must re-admit itself. */
export const SOCKET_MAX_LIFETIME_MS = 15 * 60_000

const userRoom = (userId: string) => `user:${userId}`

export function attachAccountNamespace(
  io: SocketIOServer,
  { maxLifetimeMs = SOCKET_MAX_LIFETIME_MS }: { maxLifetimeMs?: number } = {},
): void {
  io.use((socket, nextFn) => {
    const ticket = verifyRealtimeTicket(
      (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket,
    )
    if (!ticket) return nextFn(new Error('unauthorized'))
    const data = socket.data as { accountId?: string; userId?: string }
    data.accountId = ticket.accountId
    data.userId = typeof ticket.userId === 'string' ? ticket.userId : undefined
    nextFn()
  })

  io.on('connection', (socket) => {
    const { accountId, userId } = socket.data as { accountId?: string; userId?: string }
    if (accountId) socket.join(`account:${accountId}`)
    if (userId) socket.join(userRoom(userId))

    // Between 80% and 100% of the lifetime: never longer than promised.
    const lifetime = Math.round(maxLifetimeMs * (0.8 + Math.random() * 0.2))
    const expiry = setTimeout(() => socket.disconnect(true), lifetime)
    expiry.unref?.()
    socket.on('disconnect', () => clearTimeout(expiry))

    // Kept for clients still running the old page: the room is already
    // joined from the ticket, and a request for any other room is ignored.
    socket.on('join_account', () => {
      if (accountId) socket.join(`account:${accountId}`)
    })
    // Ignored. The page shares one socket between several listeners and
    // used to send this whenever one of them closed, which silently cut off
    // all the others (no ticks, no replies until a reload). Tabs still on
    // the old page keep sending it until they reload, so the server must
    // not act on it. The room is the ticket's; nothing else changes it.
    socket.on('leave_account', () => {})
  })
}

/**
 * Close every staff connection this user has, now. For a member being
 * removed, a password reset, "sign out everywhere" — anything after
 * which they must not go on receiving the account's messages. Their
 * browser will try to reconnect and, with no session, get no ticket.
 *
 * Uses the server instance server.ts puts on `global`; a no-op where
 * there is none (tests, a build step).
 */
export function disconnectUserSockets(userId: string): void {
  const io = (global as unknown as { io?: SocketIOServer }).io
  if (io && userId) io.in(userRoom(userId)).disconnectSockets(true)
}

/**
 * The socket server's CORS origin: the configured site, or same-origin
 * only. It used to fall back to "*" when NEXT_PUBLIC_SITE_URL was unset.
 * Both the staff pages and the website chat window (served from this
 * app's own origin inside its frame) connect same-origin, so nothing
 * needs a wildcard.
 */
export function socketCorsOrigin(env: Record<string, string | undefined>): string | false {
  return env.NEXT_PUBLIC_SITE_URL?.trim() || false
}
