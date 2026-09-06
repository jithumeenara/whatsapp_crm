"use client"

import { useEffect, useState } from "react"

const STEP_SECONDS = 30

/**
 * Live countdown to the next TOTP code rotation — every authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy, etc.) rotates its
 * 6-digit code on this exact 30-second boundary, and the server verifies
 * against that same 30-second step (see src/lib/auth/totp.ts). Purely
 * client-side (Date.now() mod 30) — nothing server-side needs to agree
 * with it; worst case it's off by the viewer's own clock drift, same as
 * their authenticator app already is.
 *
 * Without this, a user could type a code that just rotated a moment ago
 * without realizing it, submit it, and see "incorrect code" with no way
 * to tell whether they mistyped it or it simply went stale.
 */
function useSecondsLeft(): number {
  const [secondsLeft, setSecondsLeft] = useState(
    () => STEP_SECONDS - (Math.floor(Date.now() / 1000) % STEP_SECONDS),
  )

  useEffect(() => {
    const tick = () => setSecondsLeft(STEP_SECONDS - (Math.floor(Date.now() / 1000) % STEP_SECONDS))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return secondsLeft
}

/** Small ring + number showing how many seconds remain before the code in
 *  the user's authenticator app changes. Turns red in the last 5 seconds
 *  as a "wait for the next one" cue. */
export function TotpCountdown({ className = "" }: { className?: string }) {
  const secondsLeft = useSecondsLeft()
  const urgent = secondsLeft <= 5
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const dashoffset = circumference * (1 - secondsLeft / STEP_SECONDS)

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title="Seconds left before your authenticator app shows a new code"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0" aria-hidden="true">
        <circle
          cx="11" cy="11" r={radius} fill="none" strokeWidth="2"
          className={urgent ? "stroke-rose-200" : "stroke-slate-200"}
        />
        <circle
          cx="11" cy="11" r={radius} fill="none" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 11 11)"
          className={
            urgent
              ? "stroke-rose-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
              : "stroke-indigo-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
          }
        />
      </svg>
      <span className={`text-[11px] font-medium tabular-nums ${urgent ? "text-rose-500" : "text-slate-400"}`}>
        {secondsLeft}s
      </span>
    </span>
  )
}
