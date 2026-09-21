import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token'

/**
 * POST /api/presence/leave
 *
 * The last word from a browser that is closing.
 *
 * Sent by src/hooks/use-idle-timeout.ts via navigator.sendBeacon when
 * the last open tab goes away — closed, navigated off, or frozen by a
 * phone switching apps. It exists because closing the window is how
 * agents actually stop working, and it used to be silent: they stayed
 * green for three minutes and stayed in the flow routing pool for
 * another eight, so a customer could be handed to somebody who had shut
 * their laptop.
 *
 * ── What it deliberately does not do ────────────────────────────────
 *
 * It does not end the session. Closing a tab is not signing out — the
 * session cookie has no expiry of its own and survives until the
 * browser itself closes, and an agent who closes one window and opens
 * another has not asked to be logged out. Only /api/auth/signout does
 * that, and only the person can ask for it.
 *
 * So this records presence and nothing else, and the record is a
 * timestamp rather than a flag: src/lib/agents/presence.ts compares it
 * against last_seen_at, so the very next heartbeat from a tab that is
 * still open overrides it with no cleanup and no coordination. That is
 * what makes it safe to be slightly wrong — being wrong costs at most
 * one heartbeat, and being silent cost eleven minutes.
 *
 * Session-protected by src/proxy.ts like every route outside /api/auth/,
 * so a beacon from an expired session never reaches this handler — which
 * is harmless, because an expired session already reads as offline.
 */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: COOKIE_NAME })
  if (!token?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const left = new Date()
    const user = await prisma.user.update({
      where: { id: String(token.id) },
      data: { went_offline_at: left },
      select: { last_seen_at: true, profile: { select: { account_id: true } } },
    })

    // Announced as well as recorded, for the same reason the heartbeat
    // is: a supervisor watching the team should see somebody go when
    // they go, not up to half a minute later.
    const accountId = user.profile?.account_id
    if (accountId) {
      const { emitToAccount } = await import('@/lib/socket')
      emitToAccount(accountId, 'presence', {
        userId: String(token.id),
        lastSeenAt: user.last_seen_at?.toISOString() ?? left.toISOString(),
        wentOfflineAt: left.toISOString(),
      })
    }
  } catch (err) {
    console.error('Failed to record departure:', err)
  }

  // 204: nobody is listening. The page that sent this no longer exists.
  return new NextResponse(null, { status: 204 })
}
