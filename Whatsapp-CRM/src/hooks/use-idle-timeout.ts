'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';

// Must match src/proxy.ts's IDLE_TIMEOUT_MS — that's the actual
// enforcement point (a signed JWT claim, checked server-side on every
// request); this client-side copy only drives the warning UI and a
// slightly-earlier, friendlier sign-out than waiting for the next request
// to bounce off the server with a 401/redirect.
const IDLE_TIMEOUT_MS = 10 * 60_000
const WARNING_MS = 10_000 // show a live countdown for the last 10 seconds
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const
// Real activity refreshes the LOCAL idle clock immediately, but the
// server-side session is only refreshed at most this often — otherwise a
// moving mouse would fire a request continuously for no security benefit.
const SERVER_REFRESH_THROTTLE_MS = 60_000

export function useIdleTimeout() {
  const { status } = useSession()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastActivityRef = useRef(0)
  const lastServerRefreshRef = useRef(0)

  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setSecondsLeft(null) // any real activity dismisses an in-progress warning
    const now = Date.now()
    if (now - lastServerRefreshRef.current > SERVER_REFRESH_THROTTLE_MS) {
      lastServerRefreshRef.current = now
      // A plain fetch to a dedicated route, deliberately NOT next-auth's
      // useSession().update() — that flips SessionProvider's shared
      // `loading` state for the call's duration, which every consumer of
      // useSession() app-wide (including use-auth.tsx, whose profile
      // fetch re-runs on session status changes) re-renders in response
      // to. That was visible as the whole app periodically "refreshing"
      // during otherwise-normal use — see /api/heartbeat's own comment.
      fetch('/api/heartbeat', { method: 'POST' }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    lastActivityRef.current = Date.now()

    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, registerActivity, { passive: true })

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      const remaining = IDLE_TIMEOUT_MS - elapsed
      if (remaining <= 0) {
        signOut({ callbackUrl: '/login?reason=idle' })
        return
      }
      setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1000) : null)
    }, 1000)

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, registerActivity)
      clearInterval(interval)
    }
  }, [status, registerActivity])

  return { secondsLeft, stayActive: registerActivity }
}
