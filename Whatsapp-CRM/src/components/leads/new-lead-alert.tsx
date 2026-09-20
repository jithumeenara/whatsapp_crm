'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { UserPlus, X } from 'lucide-react'
import { useRealtime, type RealtimeEvent } from '@/hooks/use-realtime'
import type { Lead } from '@/types'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

/**
 * A new enquiry is waiting, and nobody has picked it up.
 *
 * ── Why it floats instead of living on the Leads page ───────────────
 *
 * The lead pool is only useful to somebody looking at it. An agent
 * working the Inbox, writing a broadcast or filling in a record has no
 * reason to open Leads, so a first enquiry could sit for an hour while
 * three people were at their desks. The information has to travel to
 * where they already are.
 *
 * ── Why it is a pill and not a popup ────────────────────────────────
 *
 * A modal would interrupt whatever the agent is in the middle of, which
 * is usually answering a different customer. Interrupting one customer
 * to announce another is a poor trade, and the software that does it
 * gets dismissed reflexively within a week — after which it is worse
 * than nothing, because now it is ignored *and* still firing.
 *
 * So: a small thing in the corner, with a clock on it. It says how long
 * the oldest unclaimed enquiry has been waiting, and it changes colour
 * as that gets embarrassing. Dismissing it hides it until the next
 * lead arrives, because an agent who has seen it and chosen to finish
 * their sentence first is behaving correctly.
 *
 * ── Why the clock counts up, not down ───────────────────────────────
 *
 * A countdown implies something happens at zero, and nothing does —
 * there is no auto-assignment to fire. What exists is a fact: this
 * person has been waiting four minutes. Counting up states it without
 * promising anything, and it keeps being true past the threshold, where
 * a countdown would sit at 00:00 and stop meaning anything.
 */

/** Amber past this. Long enough that a busy agent is not scolded for
 *  finishing a reply, short enough that a customer has not gone
 *  elsewhere. */
const WARN_AFTER_MS = 3 * 60_000

/** Red past this. At five minutes the enquiry is measurably going cold
 *  and somebody should stop what they are doing. */
const LATE_AFTER_MS = 5 * 60_000

interface Waiting {
  id: string
  title: string
  at: number
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function NewLeadAlert() {
  const router = useRouter()
  const pathname = usePathname()
  const { userId } = useAuth()
  const [waiting, setWaiting] = useState<Waiting[]>([])
  const [dismissed, setDismissed] = useState(false)
  // The clock, held in state rather than read during render. Rendering
  // has to give the same answer for the same inputs, and Date.now()
  // does not — the timer below is what makes it move.
  const [now, setNow] = useState(0)

  // One second, only while something is actually waiting. A timer
  // ticking on an idle page for no reason is a battery complaint.
  useEffect(() => {
    if (waiting.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waiting.length])

  const onLeadEvent = useCallback(
    (event: RealtimeEvent<Lead>) => {
      const lead = event.new as (Partial<Lead> & { ai_suggested?: boolean }) | undefined
      if (!lead) return

      if (event.eventType === 'INSERT') {
        // Only what is genuinely unclaimed and genuinely new. A lead
        // created already assigned is somebody's work, not an
        // announcement, and a suggestion is not a lead yet.
        if (lead.assigned_to) return
        if (lead.status && lead.status !== 'new') return
        if (lead.ai_suggested === true) return

        const id = String(lead.id ?? '')
        if (!id) return
        setWaiting((prev) =>
          prev.some((w) => w.id === id)
            ? prev
            : [...prev, { id, title: String(lead.title ?? 'New enquiry'), at: Date.now() }],
        )
        // A new arrival is worth showing again to somebody who dismissed
        // the last one — but only an arrival, never a tick of the clock.
        setDismissed(false)
        return
      }

      // Somebody took it, or it moved on. Either way it is no longer
      // waiting, and the pill must shrink in real time or it becomes a
      // list of things already dealt with.
      const id = String(lead.id ?? '')
      if (!id) return
      if (lead.assigned_to || (lead.status && lead.status !== 'new')) {
        setWaiting((prev) => prev.filter((w) => w.id !== id))
      }
    },
    [],
  )

  useRealtime({ channelName: 'new-lead-alert', onLeadEvent, enabled: Boolean(userId) })

  // Already looking at the list? Then it is not news — but it is not
  // handled either. Hidden rather than cleared: a lead somebody read
  // and did not claim is still waiting, and should still be there when
  // they navigate away. What removes it is a claim, which arrives as
  // its own event.
  const onLeadsPage = pathname?.startsWith('/leads') ?? false

  if (onLeadsPage || dismissed || waiting.length === 0) return null

  const oldest = waiting.reduce((a, b) => (a.at < b.at ? a : b))
  // Zero until the timer's first tick, which is a truthful "just now"
  // rather than a number invented during render.
  const waited = now > 0 ? Math.max(0, now - oldest.at) : 0
  const tone =
    waited >= LATE_AFTER_MS
      ? { ring: 'ring-rose-200', bg: 'bg-rose-600', pulse: true }
      : waited >= WARN_AFTER_MS
        ? { ring: 'ring-amber-200', bg: 'bg-amber-500', pulse: false }
        : { ring: 'ring-indigo-200', bg: 'bg-[#5B6CF9]', pulse: false }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex justify-end">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-3 rounded-2xl bg-white py-2.5 pl-2.5 pr-2 shadow-lg ring-1',
          tone.ring,
        )}
      >
        <button
          type="button"
          onClick={() => router.push('/leads?tab=new_pool')}
          className="flex items-center gap-3 text-left"
        >
          <span className={cn('relative grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone.bg)}>
            <UserPlus className="h-4 w-4 text-white" />
            {tone.pulse && (
              <span className="absolute inset-0 animate-ping rounded-xl bg-rose-500/40" aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-slate-900">
              {waiting.length === 1
                ? 'New enquiry waiting'
                : `${waiting.length} enquiries waiting`}
            </span>
            <span className="block text-[11.5px] text-slate-500">
              <span className="tabular-nums">{mmss(waited)}</span> unclaimed
              {waiting.length === 1 ? ` · ${oldest.title}` : ''}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide until the next one"
          title="Hide until the next one"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
