import { NextRequest, NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"
import { prisma } from "@/lib/db"

const COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token"

// Must match auth.ts's session.maxAge — the hard absolute cap on a
// session's total lifetime, independent of activity.
const ABSOLUTE_SESSION_MAX_AGE_S = 8 * 60 * 60

/**
 * POST /api/heartbeat
 *
 * Called by src/hooks/use-idle-timeout.ts on real user activity (throttled
 * to ~once/minute) to refresh the session's `lastActivity` claim — the
 * thing src/proxy.ts actually checks on every request to enforce the
 * 10-minute idle timeout.
 *
 * Deliberately NOT implemented via next-auth/react's useSession().update()
 * — that flips SessionProvider's shared `loading` state to true for the
 * duration of the call, which every consumer of useSession() app-wide
 * (including src/hooks/use-auth.tsx, whose profile-fetch effect depends on
 * session status) re-renders in response to — visible as the app
 * periodically "refreshing" during normal use. A plain fetch() to this
 * route touches none of that; it only re-signs and re-sets the session
 * cookie directly.
 *
 * Session-protected by src/proxy.ts like any other API route (this path
 * is deliberately NOT under /api/auth/, which is public) — a request that
 * already failed the idle check never reaches this handler at all, so an
 * already-expired session can't "revive" itself via a heartbeat.
 */
/**
 * Record that this person is here, and tell their team.
 *
 * The write and the announcement are one function because they must not
 * drift: a dot that moved without the row moving would flick back on
 * the next refetch, which reads as a flickering bug rather than as
 * presence.
 *
 * The account is looked up from the profile because presence is only
 * interesting to the people sharing an account with them.
 */
async function announcePresence(userId: string): Promise<void> {
  try {
    const seen = new Date()
    const user = await prisma.user.update({
      where: { id: userId },
      data: { last_seen_at: seen },
      select: { went_offline_at: true, profile: { select: { account_id: true } } },
    })
    const accountId = user.profile?.account_id
    if (!accountId) return

    const { emitToAccount } = await import("@/lib/socket")
    emitToAccount(accountId, "presence", {
      userId,
      lastSeenAt: seen.toISOString(),
      // Sent as it stands rather than cleared. Presence compares the
      // two, and a listener that got only half the pair would have to
      // guess at the other.
      wentOfflineAt: user.went_offline_at?.toISOString() ?? null,
    })
  } catch {
    // Swallowed on purpose. This route's job is keeping a session
    // alive, and a presence write that fails must never log anybody out.
  }
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: COOKIE_NAME })
  if (!token?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Presence, recorded rather than declared.
  //
  // This request already means "a real person did something a moment
  // ago" — it is the whole reason the route exists — so it is also the
  // cheapest honest answer to "who is at their desk". See
  // src/lib/agents/presence.ts for why a status people set by hand is
  // wrong exactly when it matters.
  //
  // It does not clear went_offline_at, and does not need to: presence
  // compares the two timestamps, so this newer one simply wins. Leaving
  // the old departure in place keeps a true record of when they last
  // left, and means two writes racing can never produce a person who is
  // neither present nor gone.
  //
  // Deliberately not awaited and deliberately swallowed: this route's
  // job is keeping a session alive, and a presence write that fails
  // must never log somebody out.
  //
  // And says so out loud. Writing the row is accurate but silent: a
  // supervisor's Members screen would only learn about it on its next
  // refetch, so somebody who had just signed in stayed grey for up to
  // half a minute on the one screen whose entire job is being current.
  void announcePresence(String(token.id))

  // Preserve the ORIGINAL sign-in's absolute cutoff rather than letting
  // encode() grant a fresh maxAge from now — otherwise every heartbeat
  // would silently extend the hard 8-hour cap indefinitely, defeating it.
  const originalIat = typeof token.iat === "number" ? token.iat : Math.floor(Date.now() / 1000)
  const absoluteCutoffS = originalIat + ABSOLUTE_SESSION_MAX_AGE_S
  const remainingS = absoluteCutoffS - Math.floor(Date.now() / 1000)
  if (remainingS <= 0) {
    // Past the absolute cap — let it expire naturally, don't re-issue.
    return NextResponse.json({ error: "Session expired" }, { status: 401 })
  }

  const updatedToken = { ...token, lastActivity: Date.now() }
  const encoded = await encode({
    token: updatedToken,
    secret: process.env.NEXTAUTH_SECRET!,
    salt: COOKIE_NAME,
    maxAge: remainingS,
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // No maxAge/expires — matches auth.ts's own cookie config: a true
    // browser session cookie, gone when the tab/window closes, regardless
    // of the JWT's own internal exp claim (which still separately caps
    // server-side validity at the absolute 8-hour mark above).
  })
  return res
}
