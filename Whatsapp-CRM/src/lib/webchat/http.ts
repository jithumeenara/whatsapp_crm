/**
 * The checks every public website-chat route makes, in one place so a new
 * route cannot forget one.
 *
 * Route handlers only — this imports next/server, which server.ts must
 * never load (see ./realtime for what the socket side uses instead).
 */

import { NextResponse } from 'next/server'
import { checkRateLimit, type RateLimitOptions } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import { hostOf } from './domains'
import { authenticateSession, type AuthenticatedSession } from './session'

/** Per visitor and per address. The address limits are generous because
 *  an office or a mobile carrier puts many real people behind one IP. */
export const WEBCHAT_LIMITS = {
  sessionPerIp: { limit: 20, windowMs: 60 * 60_000 },
  sendPerSession: { limit: 20, windowMs: 60_000 },
  sendPerIp: { limit: 120, windowMs: 60_000 },
  readPerSession: { limit: 60, windowMs: 60_000 },
  handoffPerSession: { limit: 5, windowMs: 10 * 60_000 },
  configPerIp: { limit: 300, windowMs: 60_000 },
} satisfies Record<string, RateLimitOptions>

export function jsonError(status: number, error: string, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

/** Null when allowed; otherwise the 429 to return. */
export function limit(key: string, rule: RateLimitOptions): NextResponse | null {
  const result = checkRateLimit(`webchat:${key}`, rule)
  if (result.success) return null
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
  return jsonError(429, 'Too many messages — please wait a moment.', { 'Retry-After': String(retryAfter) })
}

export function ipKey(req: Request): string {
  return clientIpKey(req.headers)
}

/**
 * Requests that act for a visitor come from the chat frame, which this
 * app serves — so a browser sends this app's own origin. Another
 * website's script calling the API directly sends its own, and is
 * refused here (and by CORS, which grants it nothing). A request with no
 * Origin at all is not a browser's cross-site call; it still needs a
 * valid session token for everything that matters.
 */
export function isFromOurFrame(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  const ours = hostOf(publicOrigin(req))
  return Boolean(ours) && hostOf(origin) === ours
}

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header)
  return match ? match[1] : null
}

export async function requireVisitor(req: Request): Promise<AuthenticatedSession | NextResponse> {
  if (!isFromOurFrame(req)) return jsonError(403, 'Not allowed from this website.')
  const session = await authenticateSession(bearer(req))
  if (!session) return jsonError(401, 'This chat has ended. Please reload the page to start again.')
  return session
}

export async function readJson(req: Request, maxBytes = 8 * 1024): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return null
  const text = await req.text().catch(() => '')
  if (!text || text.length > maxBytes) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
