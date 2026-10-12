/**
 * A website visitor's session: created when the chat window first opens,
 * proved on every request by a bearer token only that browser holds.
 *
 * What the session decides, and the browser never does:
 *
 *   - which business the visitor is talking to. The account comes from
 *     the session row, which came from the widget row, which came from
 *     the public key — never from anything in a request body.
 *   - which conversation they may read. A session sees its own thread and
 *     nothing else; there is no "load conversation X" for a client to
 *     point at somebody else's.
 *   - who the visitor is. The token is the identity. A visitor id or an
 *     email typed into the window does not bring back anybody's history —
 *     that is exactly how Intercom-style impersonation works, and why
 *     there is no such door here.
 *
 * Imported by server.ts (via ./realtime), so it must stay free of
 * next/server and of anything that pulls it in.
 */

import type { WebChatWidget } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashToken, isSessionTokenShape, newSessionToken, newVisitorId } from './tokens'

/** A visitor who comes back within this long keeps their conversation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** How stale last_seen_at may get before a request refreshes it — so an
 *  active chat is not one database write per message. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export type WebChatWidgetRow = WebChatWidget

export interface AuthenticatedSession {
  id: string
  account_id: string
  widget_id: string
  visitor_id: string
  contact_id: string | null
  conversation_id: string | null
  widget: WebChatWidgetRow
}

export async function loadEnabledWidget(publicKey: string): Promise<WebChatWidgetRow | null> {
  const widget = await prisma.webChatWidget.findUnique({ where: { public_key: publicKey } })
  if (!widget || !widget.enabled) return null
  return widget
}

export async function createSession(args: {
  widget: WebChatWidgetRow
  ipHash: string | null
  userAgent: string | null
  pageUrl: string | null
}): Promise<{ token: string; session: AuthenticatedSession; expiresAt: Date }> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const row = await prisma.webChatSession.create({
    data: {
      account_id: args.widget.account_id,
      widget_id: args.widget.id,
      token_hash: hashToken(token),
      visitor_id: newVisitorId(),
      ip_hash: args.ipHash,
      user_agent: args.userAgent?.slice(0, 300) ?? null,
      page_url: args.pageUrl?.slice(0, 500) ?? null,
      expires_at: expiresAt,
    },
  })
  return {
    token,
    expiresAt,
    session: {
      id: row.id,
      account_id: row.account_id,
      widget_id: row.widget_id,
      visitor_id: row.visitor_id,
      contact_id: null,
      conversation_id: null,
      widget: args.widget,
    },
  }
}

/**
 * The session a token proves, or null — for a token of the wrong shape,
 * an unknown one, an expired or revoked one, or one whose widget has been
 * switched off or deleted. The reasons are not distinguished to the
 * caller: a client has no legitimate use for knowing which.
 *
 * Sliding: a session in use is extended, so a regular visitor is not
 * turned into a stranger every thirty days.
 */
export async function authenticateSession(token: unknown): Promise<AuthenticatedSession | null> {
  if (!isSessionTokenShape(token)) return null
  const row = await prisma.webChatSession.findUnique({ where: { token_hash: hashToken(token) } })
  if (!row || row.revoked_at) return null
  const now = Date.now()
  if (row.expires_at.getTime() <= now) return null

  const widget = await prisma.webChatWidget.findUnique({ where: { id: row.widget_id } })
  if (!widget || !widget.enabled || widget.account_id !== row.account_id) return null

  if (now - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.webChatSession
      .update({
        where: { id: row.id },
        data: { last_seen_at: new Date(now), expires_at: new Date(now + SESSION_TTL_MS) },
      })
      .catch(() => {})
  }

  return {
    id: row.id,
    account_id: row.account_id,
    widget_id: row.widget_id,
    visitor_id: row.visitor_id,
    contact_id: row.contact_id,
    conversation_id: row.conversation_id,
    widget,
  }
}

/** Expired sessions with no conversation are noise; the rest are kept
 *  only as long as the session itself. Run from server.ts's sweeps. */
export async function sweepExpiredWebChatSessions(): Promise<number> {
  const { count } = await prisma.webChatSession.deleteMany({
    where: { expires_at: { lt: new Date() } },
  })
  return count
}
