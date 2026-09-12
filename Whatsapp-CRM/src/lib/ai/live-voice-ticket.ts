/**
 * Short-lived tickets authorising one live-voice session.
 *
 * A WebSocket upgrade is not a Next.js route handler — it is served by
 * the raw HTTP server in server.ts, outside the request pipeline where
 * `requireRole()` works. Rather than re-implementing session-cookie
 * parsing in the socket layer (where a mistake means an unauthenticated
 * audio stream against the account's API key), the browser first calls
 * an ordinary authenticated route, which issues a signed ticket. The
 * socket then only has to verify a signature.
 *
 * The ticket carries the account id, so the socket never takes an
 * account from anything the client said.
 */

import crypto from 'crypto'

/** Long enough to open a socket, far too short to be worth passing on.
 *  The ticket is spent at connection time; the session itself then runs
 *  for as long as it runs. */
const TICKET_TTL_MS = 60_000

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
  if (!value) throw new Error('No signing secret is configured.')
  return value
}

export interface TicketPayload {
  accountId: string
  userId: string
  /** 'customer' rehearses what a real customer would hear; 'admin' talks
   *  to the internal data assistant. */
  mode: 'customer' | 'admin'
  exp: number
}

export function issueLiveVoiceTicket(payload: Omit<TicketPayload, 'exp'>): string {
  const body: TicketPayload = { ...payload, exp: Date.now() + TICKET_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/** Returns null for anything that fails, without saying which check
 *  failed — the client has no legitimate use for that distinction. */
export function verifyLiveVoiceTicket(ticket: string): TicketPayload | null {
  try {
    const [encoded, signature] = ticket.split('.')
    if (!encoded || !signature) return null

    const expected = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url')
    // Constant-time: a plain === leaks how much of the signature matched.
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketPayload
    if (!payload.accountId || typeof payload.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
