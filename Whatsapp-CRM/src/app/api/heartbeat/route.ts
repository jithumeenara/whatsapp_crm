import { NextRequest, NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"

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
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: COOKIE_NAME })
  if (!token?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
