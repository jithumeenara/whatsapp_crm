'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, TrendingDown, Clock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Where leads are lost, and where the open ones are stuck.
 *
 * ── Why the drop is the headline ────────────────────────────────────
 *
 * The usual funnel shows how many reached each stage, which reads as
 * progress and is easy to feel good about. The number somebody can act
 * on is the other one: how many were lost *at this step*. "We lost 40
 * people between picking up and contacting" names a problem and a place
 * to look; "62% reached contacted" names neither.
 *
 * ── Why the second half exists ──────────────────────────────────────
 *
 * A funnel is history, and nobody can change history. The open leads
 * sitting in each stage, with how long they have been sitting, are this
 * afternoon's work. Median rather than mean, because one lead forgotten
 * for six months would drag an average past anything anyone recognises.
 */

interface Stage {
  key: string
  label: string
  count: number
  dropFromPrevious: number
  percentOfCreated: number
}

interface FunnelData {
  days: number
  total: number
  stages: Stage[]
  open: Array<{ status: string; count: number; medianDaysUntouched: number }>
  bySource: Array<{ source: string; total: number; converted: number; rate: number }>
  lostReasons: Array<{ reason: string; count: number }>
}

/**
 * Every row of the funnel, on one set of columns.
 *
 * The first version laid each row out with `justify-between`, which
 * pushes the numbers to the right edge and lets their own width decide
 * where they sit. A row carrying a "-7" put its count in a different
 * place from a row without one, so no column lined up with the column
 * above it and the eye could not run down the figures at all — which is
 * the only thing a reader does with a funnel.
 *
 * Fixed tracks fix that: label, bar, then three numeric columns of
 * declared width. The numbers are right-aligned and tabular, so digits
 * sit under digits whether the count is 7 or 1,400.
 */
const ROW = 'grid grid-cols-[5.5rem_1fr_2.5rem_2.75rem_2.5rem] items-center gap-x-2 sm:grid-cols-[7rem_1fr_3rem_3rem_3rem] sm:gap-x-3'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

function prettyStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function ConversionFunnel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<FunnelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/leads/funnel?days=${days}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not build the funnel.')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the funnel.')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Working it out…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
        {error}
      </div>
    )
  }

  if (!data) return null

  const converted = data.stages.find((s) => s.key === 'converted')?.count ?? 0
  const rate = data.total > 0 ? Math.round((converted / data.total) * 100) : 0
  // The step that lost the most. Named outright rather than left for the
  // reader to find by comparing six bars.
  const worst = [...data.stages].sort((a, b) => b.dropFromPrevious - a.dropFromPrevious)[0]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-slate-900">Where leads are lost</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            {data.total} lead{data.total === 1 ? '' : 's'} created in this period ·{' '}
            <span className="font-medium text-slate-700">{rate}% converted</span>
          </p>
        </div>
        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={cn(
                'h-7 rounded-lg px-2.5 text-[12px] font-medium transition-colors',
                days === r.days ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {data.total === 0 ? (
        <p className="rounded-2xl border border-slate-200 py-10 text-center text-[13px] text-slate-400">
          No leads created in this period.
        </p>
      ) : (
        <>
          {worst && worst.dropFromPrevious > 0 && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[12.5px] leading-relaxed text-amber-900">
                Most are lost at <strong>{worst.label.toLowerCase()}</strong> —{' '}
                {worst.dropFromPrevious} of them never got that far.
              </p>
            </div>
          )}

          {/* The funnel itself */}
          <div className="rounded-2xl border border-slate-200 p-4">
            {/* Column headings. Three numbers a row needs naming once,
                not guessing at six times. */}
            <div className={cn(ROW, 'pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400')}>
              <span>Stage</span>
              <span />
              <span className="text-right">Got</span>
              <span className="text-right">Lost</span>
              <span className="text-right">%</span>
            </div>

            <div className="space-y-1.5">
              {data.stages.map((stage, i) => {
                const lost = i > 0 ? stage.dropFromPrevious : 0
                return (
                  <div key={stage.key} className={ROW}>
                    <span className="truncate text-[12.5px] text-slate-700" title={stage.label}>
                      {stage.label}
                    </span>

                    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-[#6C7BFF] to-[#5B6CF9] transition-[width] duration-500"
                        style={{ width: `${Math.max(1, stage.percentOfCreated)}%` }}
                      />
                    </span>

                    <span className="text-right text-[13px] font-semibold tabular-nums text-slate-800">
                      {stage.count}
                    </span>

                    {/* The column keeps its place when there is nothing
                        to put in it. A cell that vanishes takes the
                        alignment of every row below it with it. */}
                    <span
                      className={cn(
                        'text-right text-[11.5px] tabular-nums',
                        lost > 0 ? 'text-rose-500' : 'text-slate-300',
                      )}
                    >
                      {lost > 0 ? `−${lost}` : '—'}
                    </span>

                    <span className="text-right text-[11px] tabular-nums text-slate-400">
                      {stage.percentOfCreated}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* The half somebody can act on today */}
          {data.open.length > 0 && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                Still open, and for how long
              </p>
              <div className="mt-3 space-y-1">
                <div className="grid grid-cols-[1fr_2.5rem_5.5rem] items-center gap-x-3 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <span>Stage</span>
                  <span className="text-right">Open</span>
                  <span className="text-right">Untouched</span>
                </div>
                {data.open.map((row) => (
                  <div
                    key={row.status}
                    className="grid grid-cols-[1fr_2.5rem_5.5rem] items-center gap-x-3 rounded-lg bg-slate-50/70 px-3 py-2"
                  >
                    <span className="truncate text-[12.5px] text-slate-700">
                      {prettyStatus(row.status)}
                    </span>
                    <span className="text-right text-[12.5px] font-semibold tabular-nums text-slate-800">
                      {row.count}
                    </span>
                    <span
                      className={cn(
                        'text-right text-[11.5px] tabular-nums',
                        row.medianDaysUntouched >= 3 ? 'font-medium text-rose-600' : 'text-slate-400',
                      )}
                    >
                      {row.medianDaysUntouched}d
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Median, not average — one forgotten lead would drag a mean past anything you would
                recognise.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {data.bySource.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-[13px] font-semibold text-slate-800">Which sources convert</p>
                <div className="mt-3 space-y-1.5">
                  <div className="grid grid-cols-[1fr_3.5rem_2.75rem] items-center gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <span>Source</span>
                    <span className="text-right">Won</span>
                    <span className="text-right">Rate</span>
                  </div>
                  {data.bySource.map((row) => (
                    <div
                      key={row.source}
                      className="grid grid-cols-[1fr_3.5rem_2.75rem] items-center gap-x-3"
                    >
                      <span className="truncate text-[12.5px] capitalize text-slate-700" title={row.source}>
                        {row.source}
                      </span>
                      <span className="text-right text-[12px] tabular-nums text-slate-500">
                        {row.converted}/{row.total}
                      </span>
                      <span
                        className={cn(
                          'text-right text-[12px] font-semibold tabular-nums',
                          row.rate >= 20 ? 'text-emerald-600' : 'text-slate-400',
                        )}
                      >
                        {row.rate}%
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Volume without conversion is the trap this answers.
                </p>
              </div>
            )}

            {data.lostReasons.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                  <AlertTriangle className="h-3.5 w-3.5 text-slate-400" />
                  Why they were lost
                </p>
                <div className="mt-3 space-y-1.5">
                  {data.lostReasons.map((row) => (
                    <div
                      key={row.reason}
                      className="grid grid-cols-[1fr_2.5rem] items-center gap-x-3"
                    >
                      <span className="truncate text-[12.5px] text-slate-700" title={row.reason}>
                        {row.reason}
                      </span>
                      <span className="text-right text-[12px] font-semibold tabular-nums text-slate-600">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
