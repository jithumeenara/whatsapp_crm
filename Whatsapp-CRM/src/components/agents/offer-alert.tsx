'use client'

/**
 * "A customer wants your help" — the one interruption worth making.
 *
 * ── Why this one may interrupt when nothing else does ───────────────
 *
 * Everything else the app tells an agent can wait: a lead in the pool,
 * an unread message, a follow-up due. This cannot, and not because it
 * is more important — because it is addressed to them personally and
 * expires. In sixty seconds it goes to somebody else, and the customer
 * waits another minute for the privilege.
 *
 * That is also the only reason it is allowed a sound. An alert that
 * fires for things which would still be true in ten minutes is an alert
 * people learn to close; the standard for interrupting one person is
 * roughly once per ten minutes, and this is built to stay well inside
 * it — offers only happen when the assistant has already given up, and
 * the rotation stops after two rounds rather than ringing all night.
 *
 * ── Why it says whether the sound works ─────────────────────────────
 *
 * Browsers refuse audio until the person has clicked something, and
 * they refuse it silently. An agent who opened the CRM and started
 * reading would get no sound, no error, and would conclude there were
 * no customers. So the card says plainly when sound is off and how to
 * turn it on, rather than letting somebody find out by missing one.
 *
 * ── Why declining is a button ───────────────────────────────────────
 *
 * Somebody who already knows they cannot take this — on a call, about
 * to leave — helps the customer by saying so, and it moves the offer on
 * immediately rather than burning the rest of the minute. Forcing them
 * to sit out the countdown teaches them to ignore the card instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Headphones, Loader2, VolumeX, X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { armOnFirstGesture, onArmedChange, playAlert } from '@/lib/agents/alert-sound'
import { cn } from '@/lib/utils'

interface Offer {
  id: string
  conversation_id: string
  seconds_left: number
  window_seconds: number
  reason: string
  outside_speciality: boolean
  customer_name: string | null
  customer_phone: string | null
  customer_said: string | null
}

/** Slow, because the socket is what makes this feel instant and the
 *  poll is only here so a dropped connection cannot hide an offer
 *  entirely. */
const POLL_MS = 20_000

export function OfferAlert() {
  const router = useRouter()
  const { userId } = useAuth()
  const [offers, setOffers] = useState<Offer[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [soundArmed, setSoundArmed] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [offerDeadlines, setOfferDeadlines] = useState<Record<string, number>>({})
  // Which offers have already made a noise, so a poll that returns the
  // same one does not chime every twenty seconds.
  const chimedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    armOnFirstGesture()
    return onArmedChange(setSoundArmed)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/offers', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { offers: Offer[] }
      setOffers(data.offers)
      setOfferDeadlines((previous) => {
        const next = { ...previous }
        const loadedAt = Date.now()
        for (const offer of data.offers) {
          if (next[offer.id] === undefined) {
            next[offer.id] = loadedAt + offer.seconds_left * 1000
          }
        }
        return next
      })
      for (const o of data.offers) {
        if (!chimedRef.current.has(o.id)) {
          chimedRef.current.add(o.id)
          playAlert()
        }
      }
    } catch {
      // The next poll will do. A failed fetch must not clear the card
      // somebody is looking at.
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    void load()
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [userId, load])

  // The countdown. One second, and only while something is on screen —
  // a timer ticking on an idle page for no reason is a battery
  // complaint.
  useEffect(() => {
    if (offers.length === 0) return
    const t = setInterval(() => setCurrentTime(Date.now()), 1000)
    return () => clearInterval(t)
  }, [offers.length])

  const onOffer = useCallback(
    (event: { userId: string }) => {
      // Broadcast to the account; ignore anything not addressed here.
      if (event.userId !== userId) return
      void load()
    },
    [userId, load],
  )

  useRealtime({ channelName: 'offer-alert', onOfferEvent: onOffer, enabled: Boolean(userId) })

  async function answer(offer: Offer, action: 'accept' | 'decline') {
    setBusy(offer.id)
    // Removed first. The card has done its job either way, and one that
    // lingers while the network thinks makes people press again.
    setOffers((prev) => prev.filter((o) => o.id !== offer.id))
    try {
      const res = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (action === 'accept') {
        if (res.ok) router.push(`/inbox?c=${offer.conversation_id}`)
        // A lost race is not an error the agent made. Reloading shows
        // them whatever is true now instead of an explanation.
        else void load()
      }
    } catch {
      void load()
    } finally {
      setBusy(null)
    }
  }

  if (offers.length === 0) return null

  const offer = offers[0]
  const deadline = offerDeadlines[offer.id]
  const left = deadline === undefined
    ? offer.seconds_left
    : Math.max(0, Math.ceil((deadline - currentTime) / 1000))
  const urgent = left <= 15

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex justify-end">
      <div
        className={cn(
          'pointer-events-auto w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl bg-white shadow-xl ring-2 transition-colors',
          urgent ? 'ring-rose-300' : 'ring-rose-200',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2.5 px-4 py-2.5 text-white transition-colors',
            urgent ? 'bg-rose-600' : 'bg-rose-500',
          )}
        >
          <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20">
            <Headphones className="h-3.5 w-3.5" />
            <span
              className="absolute inset-0 rounded-lg bg-white/30 motion-safe:animate-ping"
              aria-hidden
            />
          </span>
          <span className="flex-1 text-[13px] font-semibold">A customer wants your help</span>
          <span className="shrink-0 text-[13px] font-bold tabular-nums">
            {String(Math.floor(left / 60))}:{String(left % 60).padStart(2, '0')}
          </span>
        </div>

        <div className="px-4 pb-1 pt-3">
          <p className="truncate text-[13px] font-semibold text-slate-800">
            {offer.customer_name?.trim() || offer.customer_phone || 'A customer'}
          </p>
          {offer.customer_said && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-600">
              &ldquo;{offer.customer_said}&rdquo;
            </p>
          )}
          {/* Said out loud, because an agent who does not do Dental
              should know why a Dental question reached them rather than
              assuming the routing is broken. */}
          {offer.outside_speciality && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              Outside your subjects — nobody who handles it is free.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 pb-3 pt-2">
          <button
            type="button"
            onClick={() => void answer(offer, 'accept')}
            disabled={busy === offer.id}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#5B6CF9] text-[13px] font-semibold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
          >
            {busy === offer.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            I&rsquo;ll take it
          </button>
          <button
            type="button"
            onClick={() => void answer(offer, 'decline')}
            disabled={busy === offer.id}
            title="Pass it to somebody else now"
            aria-label="Pass it to somebody else now"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The line that stops a silent failure looking like quiet. */}
        {!soundArmed && (
          <p className="flex items-center gap-1.5 border-t border-slate-100 bg-amber-50 px-4 py-2 text-[11px] leading-relaxed text-amber-800">
            <VolumeX className="h-3 w-3 shrink-0" />
            Sound is off until you click anywhere on the page — your browser requires it.
          </p>
        )}

        {offers.length > 1 && (
          <p className="border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-500">
            {offers.length - 1} more waiting for you.
          </p>
        )}
      </div>
    </div>
  )
}
