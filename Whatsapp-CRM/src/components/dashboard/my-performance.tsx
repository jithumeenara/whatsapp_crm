'use client'

import { useCallback, useEffect, useState } from 'react'
import { PhoneCall, PhoneOff, Trophy, HandCoins, Inbox } from 'lucide-react'

/**
 * How this week went for the person looking at it.
 *
 * ── Why activity and outcome are shown together ─────────────────────
 *
 * Either number alone rewards the wrong thing. Calls made alone favours
 * whoever rings fifty people badly; conversions alone punishes whoever
 * was handed the worst leads. Side by side they are a conversation: a
 * high reach rate and no conversions is a script problem, a low reach
 * rate and good conversions is a timing problem, and both being low is
 * the one worth asking about.
 *
 * ── Why there is no target and no colour ────────────────────────────
 *
 * No red numbers, no percentage of a quota. The moment a screen grades
 * somebody, the number it grades on is the one that gets managed —
 * agents pick the easy leads, mark a call connected when it rang out,
 * and the figures improve while the business does not. These are
 * counts, shown plainly, for a person and their supervisor to read
 * together.
 */

interface Performance {
  picked: number
  attempted: number
  reached: number
  missed: number
  reachedPct: number | null
  won: number
  lost: number
  conversionPct: number | null
  leadsWorked: number
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const

export function MyPerformance() {
  const [days, setDays] = useState<number>(7)
  const [data, setData] = useState<Performance | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (forDays: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/performance?days=${forDays}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const body = (await res.json()) as { me: Performance | null }
      setData(body.me)
    } catch {
      // Leave the last figures on screen. Replacing them with zeros
      // because one request failed would report a quiet week that did
      // not happen.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const cards = [
    {
      label: 'Leads picked',
      value: data?.picked ?? 0,
      icon: Inbox,
      tint: 'bg-sky-50 text-sky-600',
      foot: data ? `${data.leadsWorked} rung` : null,
    },
    {
      label: 'Got through',
      value: data?.reached ?? 0,
      icon: PhoneCall,
      tint: 'bg-emerald-50 text-emerald-600',
      foot: data?.reachedPct !== null && data?.reachedPct !== undefined
        ? `${data.reachedPct}% of ${data.attempted} calls`
        : 'No calls yet',
    },
    {
      label: 'No answer',
      value: data?.missed ?? 0,
      icon: PhoneOff,
      tint: 'bg-amber-50 text-amber-600',
      foot: null,
    },
    {
      label: 'Won',
      value: data?.won ?? 0,
      icon: Trophy,
      tint: 'bg-violet-50 text-violet-600',
      foot: data?.conversionPct !== null && data?.conversionPct !== undefined
        ? `${data.conversionPct}% of ${data.won + data.lost} closed`
        : 'Nothing closed yet',
    },
  ]

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Your work</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                days === r.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-slate-50/70 p-3">
            <div className="flex items-center gap-2">
              <span className={`grid h-7 w-7 place-items-center rounded-lg ${c.tint}`}>
                <c.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11.5px] font-medium text-slate-500">{c.label}</span>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">
              {loading && !data ? '—' : c.value}
            </p>
            {/* The denominator, always. "12 calls connected" means
                nothing without knowing whether 15 or 90 were made. */}
            {c.foot && <p className="mt-0.5 text-[11px] text-slate-400">{c.foot}</p>}
          </div>
        ))}
      </div>

      {data && data.attempted === 0 && data.picked === 0 && (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[12.5px] text-slate-500">
          Nothing recorded in the last {days} days. Numbers appear here as you pick
          up leads and log how the calls went.
        </p>
      )}
    </section>
  )
}

/** Same figures for a whole team, for somebody who can see them all. */
export function TeamPerformance() {
  const [days, setDays] = useState<number>(7)
  const [rows, setRows] = useState<Array<Performance & { user_id: string; full_name: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/dashboard/performance?days=${days}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.team) return
        setRows(body.team)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days])

  // Nobody who did nothing at all. A roster padded with zero rows
  // buries the people who worked, and the absence is visible in the
  // Members list anyway.
  const active = rows.filter((r) => r.picked > 0 || r.attempted > 0 || r.won > 0 || r.lost > 0)

  if (!loading && active.length === 0) return null

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Team</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                days === r.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-[12.5px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400">
              <th className="pb-2 font-medium">Agent</th>
              <th className="pb-2 text-right font-medium">Picked</th>
              <th className="pb-2 text-right font-medium">Calls</th>
              <th className="pb-2 text-right font-medium">Got through</th>
              <th className="pb-2 text-right font-medium">Won</th>
              <th className="pb-2 text-right font-medium">Lost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {active.map((r) => (
              <tr key={r.user_id} className="text-slate-700">
                <td className="py-2 font-medium text-slate-800">{r.full_name || '—'}</td>
                <td className="py-2 text-right tabular-nums">{r.picked}</td>
                <td className="py-2 text-right tabular-nums">{r.attempted}</td>
                <td className="py-2 text-right tabular-nums">
                  {r.reached}
                  {r.reachedPct !== null && (
                    <span className="ml-1 text-[11px] text-slate-400">{r.reachedPct}%</span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{r.won}</td>
                <td className="py-2 text-right tabular-nums">{r.lost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
