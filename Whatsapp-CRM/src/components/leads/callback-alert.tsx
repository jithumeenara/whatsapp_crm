'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneCall, X, ChevronRight, Clock } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'

/**
 * "You said you would ring these people back, and that time has passed."
 *
 * ── Why this exists separately from the Follow-ups page ─────────────
 *
 * A promise to call at four o'clock is only kept if somebody is looking
 * at four o'clock. The Follow-ups page holds every one of them, which
 * means it is the right place to plan a day and the wrong place to
 * catch a moment: nobody keeps a tab open on it, so the callback the
 * assistant arranged passes quietly and the customer waits by a phone
 * that does not ring.
 *
 * So this comes to the agent instead of waiting for the agent to come
 * to it — once when they sign in, and again the moment one falls due
 * while they are working.
 *
 * ── Why it is quiet about other people's work ───────────────────────
 *
 * Only callbacks for customers this person picked. An alert that shows
 * everybody's is an alert that is nearly always about somebody else,
 * and the one it counts on being read is the one it has already trained
 * people to close. What "theirs" means is decided server-side — see
 * /api/follow-ups/due, where it turns out not to be as simple as the
 * assignee field.
 */

interface DueCallback {
  id: string
  title: string
  note: string | null
  due_at: string
  lead_id: string | null
  contact_id: string | null
  contact_name: string | null
  contact_phone: string | null
}

/** Often enough to feel immediate, rarely enough to cost nothing. */
const POLL_MS = 60_000

/** More than this and the card becomes a list to scroll rather than a
 *  thing to act on. The rest stay one click away. */
const SHOWN = 3

function howLate(dueAt: string, now: number): string {
  const ms = now - new Date(dueAt).getTime()
  if (ms < 60_000) return 'due now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min late`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h late`
  return `${Math.floor(hours / 24)}d late`
}

export function CallbackAlert() {
  const router = useRouter()
  const { userId, canViewAllLeads } = useAuth()
  const [due, setDue] = useState<DueCallback[]>([])
  const [unclaimed, setUnclaimed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Closed for this session, by id. Not persisted: signing in again is
  // exactly the moment somebody should be reminded.
  const dismissed = useRef<Set<string>>(new Set())
  // Kept so that a poll returning the same rows does not re-open a card
  // the agent has already put away, while a genuinely new one does.
  const seen = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/follow-ups/due', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { due: DueCallback[]; unclaimed_count: number }

      const fresh = data.due.filter((d) => !dismissed.current.has(d.id))
      setDue(fresh)
      setUnclaimed(data.unclaimed_count ?? 0)

      // A callback that has just fallen due re-opens the card even if
      // the agent collapsed it earlier — it is new information.
      if (fresh.some((d) => !seen.current.has(d.id))) setExpanded(true)
      for (const d of fresh) seen.current.add(d.id)
    } catch {
      // The next poll will do. A failed fetch must not clear the card
      // and make somebody think the list emptied itself.
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    void load()
    const id = setInterval(() => {
      void load()
      setNow(Date.now())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [userId, load])

  function open(cb: DueCallback) {
    dismissed.current.add(cb.id)
    setDue((prev) => prev.filter((d) => d.id !== cb.id))
    // The lead if there is one — that is where the call is logged and
    // the outcome recorded. A contact with no lead is still worth
    // reaching, so it falls back rather than doing nothing.
    if (cb.lead_id) router.push(`/leads/${cb.lead_id}`)
    else if (cb.contact_id) router.push(`/contacts?c=${cb.contact_id}`)
  }

  function dismiss(id: string) {
    dismissed.current.add(id)
    setDue((prev) => prev.filter((d) => d.id !== id))
  }

  if (!userId || due.length === 0) return null

  const shown = expanded ? due.slice(0, SHOWN) : []
  const hidden = due.length - shown.length

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end gap-2">
      {shown.map((cb) => (
        // A div, not a button: the dismiss control below is itself a
        // button, and HTML does not allow one inside another. Nesting
        // them leaves the inner one unreachable by keyboard in some
        // browsers, which is the half of the card somebody needs when
        // the alert is wrong.
        <div
          key={cb.id}
          role="button"
          tabIndex={0}
          onClick={() => open(cb)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open(cb)
            }
          }}
          className="pointer-events-auto w-full cursor-pointer rounded-2xl bg-white p-3 text-left shadow-lg ring-1 ring-amber-200 transition-shadow hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-50">
              <PhoneCall className="h-4 w-4 text-amber-600" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-slate-800">
                {cb.contact_name || cb.contact_phone || 'Call back'}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-amber-700">
                <Clock className="h-3 w-3" />
                {howLate(cb.due_at, now)}
              </span>
              {cb.note && (
                <span className="mt-1 block truncate text-[11.5px] text-slate-500">{cb.note}</span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Dismiss callback for ${cb.contact_name || cb.contact_phone || 'this customer'}`}
              onClick={(e) => {
                e.stopPropagation()
                dismiss(cb.id)
              }}
              className="-m-1 shrink-0 rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-[13px] font-semibold text-white shadow-lg transition-colors hover:bg-amber-600"
      >
        <PhoneCall className="h-3.5 w-3.5" />
        {due.length} call{due.length === 1 ? '' : 's'} to make
        {hidden > 0 && expanded && <span className="text-amber-100">+{hidden}</span>}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Only to somebody who can act on it across the account. An agent
          cannot pick up a customer who is not theirs, so telling them
          the number would be noise they can do nothing about. */}
      {canViewAllLeads && unclaimed > 0 && (
        <button
          type="button"
          onClick={() => router.push('/follow-ups')}
          className="pointer-events-auto rounded-full bg-white px-3 py-1.5 text-[11.5px] text-slate-500 shadow ring-1 ring-slate-200 hover:text-slate-700"
        >
          {unclaimed} more nobody has picked up
        </button>
      )}
    </div>
  )
}
