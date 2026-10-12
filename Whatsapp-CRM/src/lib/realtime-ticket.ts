/**
 * Short-lived tickets that admit a browser to its account's live updates.
 *
 * ── The gap this closes ─────────────────────────────────────────────
 *
 * The socket server used to put a connection into whatever account room
 * it asked for: `join_account` took an account id from the client and
 * checked nothing else. CORS does not help — it is something browsers
 * agree to obey, and a script does not — so anyone who learned an
 * account id could listen to that business's messages as they arrived.
 *
 * The fix is the one the live-voice relay already uses: the browser asks
 * an ordinary authenticated route for a signed ticket, and the socket
 * layer only verifies a signature. The account comes from the ticket,
 * never from anything the client says.
 *
 * Signed with a key derived for this purpose alone, so a ticket issued
 * here can never be presented to the live-voice relay (which admits
 * admins only), or the other way round.
 *
 * Imported by server.ts, so this file must stay free of next/server and
 * of anything that pulls it in.
 */

import crypto from 'crypto'

/** Long enough to open a socket. It is spent at connection time, and a
 *  reconnect fetches a fresh one. */
const TICKET_TTL_MS = 60_000

function key(): Buffer {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
  if (!value) throw new Error('No signing secret is configured.')
  return crypto.createHash('sha256').update(`${value}:realtime-ticket`).digest()
}

export interface RealtimeTicket {
  accountId: string
  userId: string
  exp: number
}

export function issueRealtimeTicket(payload: Omit<RealtimeTicket, 'exp'>): string {
  const body: RealtimeTicket = { ...payload, exp: Date.now() + TICKET_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url')
  const signature = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/** Null for anything that fails, without saying which check failed. */
export function verifyRealtimeTicket(ticket: unknown): RealtimeTicket | null {
  try {
    if (typeof ticket !== 'string' || ticket.length > 2048) return null
    const [encoded, signature] = ticket.split('.')
    if (!encoded || !signature) return null

    const expected = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as RealtimeTicket
    if (typeof payload.accountId !== 'string' || !payload.accountId) return null
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
