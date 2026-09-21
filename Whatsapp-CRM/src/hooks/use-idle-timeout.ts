'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { IDLE_TIMEOUT_MS, HEARTBEAT_THROTTLE_MS } from '@/lib/auth/session-timing';
import { newTabId, touchTab, releaseTab, TAB_TOUCH_MS } from '@/lib/agents/open-tabs';

// The idle timeout and the heartbeat throttle are imported, not written
// here: src/proxy.ts enforces the first on every request and
// src/lib/agents/presence.ts derives the presence windows from both, so
// a local copy would be a third opinion about the same fact. See
// src/lib/auth/session-timing.ts.
const WARNING_MS = 10_000; // show a live countdown for the last 10 seconds
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

export function useIdleTimeout() {
  const { status } = useSession()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastActivityRef = useRef(0)
  const lastServerRefreshRef = useRef(0)

  const beat = useCallback(() => {
    lastServerRefreshRef.current = Date.now()
    // A plain fetch to a dedicated route, deliberately NOT next-auth's
    // useSession().update() — that flips SessionProvider's shared
    // `loading` state for the call's duration, which every consumer of
    // useSession() app-wide (including use-auth.tsx, whose profile
    // fetch re-runs on session status changes) re-renders in response
    // to. That was visible as the whole app periodically "refreshing"
    // during otherwise-normal use — see /api/heartbeat's own comment.
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {})
  }, [])

  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setSecondsLeft(null) // any real activity dismisses an in-progress warning
    // Real activity refreshes the LOCAL idle clock immediately, but the
    // server is only told this often — otherwise a moving mouse would
    // fire a request continuously for no security benefit.
    if (Date.now() - lastServerRefreshRef.current > HEARTBEAT_THROTTLE_MS) beat()
  }, [beat])

  useEffect(() => {
    if (status !== 'authenticated') return
    lastActivityRef.current = Date.now()

    // Arriving counts.
    //
    // The heartbeat used to wait for the first mouse movement, which
    // meant somebody who logged in and started reading was recorded as
    // present only once they moved — and, worse, somebody who reloaded
    // the page after the farewell below had fired stayed marked as gone
    // until they touched something. Opening the app is itself proof that
    // a person is there.
    beat()

    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, registerActivity, { passive: true })

    // ── Telling the server this window is open, and then closing ──────
    //
    // Separate from the heartbeat on purpose. The heartbeat answers "is
    // this person working" and is throttled by their activity; this
    // answers "is a window open", which has to keep ticking while
    // somebody reads a long conversation without moving.
    const tabId = newTabId()
    touchTab(tabId)
    const tabTimer = setInterval(() => touchTab(tabId), TAB_TOUCH_MS)

    const onPageHide = () => {
      // Only the last window out says anything — an agent with the Inbox
      // in one tab and Leads in another must not be marked offline for
      // closing one of them. See src/lib/agents/open-tabs.ts.
      if (!releaseTab(tabId)) return
      // sendBeacon, because a page being torn down is not allowed to
      // wait for a response and fetch() would simply be cancelled. The
      // browser delivers this after the page is gone.
      try {
        navigator.sendBeacon('/api/presence/leave')
      } catch {
        // A browser that refuses is no worse off than before this
        // existed: the idle timeout still reports them offline.
      }
    }

    // Coming back from the browser's back/forward cache, or from another
    // app on a phone, does not re-run this effect — the page was frozen,
    // not reloaded. Without this the farewell above would stand and the
    // person would read as offline while looking straight at the app.
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      touchTab(tabId)
      beat()
    }

    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onReturn)
    document.addEventListener('visibilitychange', onReturn)

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      const remaining = IDLE_TIMEOUT_MS - elapsed
      if (remaining <= 0) {
        // The session is over either way — the proxy would refuse the
        // next request. Signing out properly is what makes the timeout
        // visible to everybody else: it fires the sign-out event in
        // src/auth.ts, which records the departure, so a supervisor sees
        // this agent go grey instead of waiting for the clock to say so.
        signOut({ callbackUrl: '/login?reason=idle' })
        return
      }
      setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1000) : null)
    }, 1000)

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, registerActivity)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      clearInterval(interval)
      clearInterval(tabTimer)
    }
  }, [status, registerActivity, beat])

  return { secondsLeft, stayActive: registerActivity }
}
