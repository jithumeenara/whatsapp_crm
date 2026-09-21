'use client'

/**
 * The switch that lets the assistant act, and the evidence for doing it.
 *
 * ── Why the middle position exists ──────────────────────────────────
 *
 * Switching this straight on would mean trusting a number nobody has
 * seen. Accuracy on classification genuinely differs by business —
 * "any vacancy?" is not a lead at a coaching institute and very much is
 * one at a recruitment agency — so a figure measured anywhere else is
 * not evidence about this account.
 *
 * Watching solves that. The assistant judges every handover and writes
 * down what it would have done, while doing none of it. A week later
 * the owner has a real figure on their own messages and can decide.
 *
 * ── Why the accuracy figure lives on the same card ──────────────────
 *
 * It is the argument for moving the switch. Putting it on another
 * screen would mean deciding here and checking there, and the checking
 * is the part that gets skipped.
 *
 * ── Why the confusion list matters more than the percentage ─────────
 *
 * "83%" tells somebody whether to trust it. "Ortho was really Physio,
 * 14 times" tells them what to fix — and the fix is one line in the
 * category's hint, not a better model. Research on classification into
 * fine-grained labels converges on exactly this: the pairs that swap
 * are the whole problem.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Eye, EyeOff, Zap, TrendingUp, AlertTriangle } from 'lucide-react'

interface Accuracy {
  days: number
  judged: number
  reviewed: number
  lead_percent: number | null
  category_percent: number | null
  category_judged: number
  confusion: Array<{ said: string; was: string; count: number }>
  missed: Array<{ reason: string; count: number }>
  would_have: { created_leads: number; stayed_silent: number; alerted_urgently: number }
  acted: number
}

const MISSED_LABELS: Record<string, string> = {
  existing_customer: 'existing customers',
  job_application: 'job applications',
  vendor_or_sales: 'people selling to you',
  complaint: 'complaints',
  spam_or_wrong_number: 'spam or wrong numbers',
  out_of_scope: 'things you do not offer',
  unclear: 'messages it found unclear',
}

const MODES = [
  {
    value: 'off',
    icon: EyeOff,
    title: 'Off',
    body: 'Nothing is judged and nothing is recorded. Handovers work exactly as they do today.',
  },
  {
    value: 'observe',
    icon: Eye,
    title: 'Watching',
    body: 'It reads every handover and writes down what it would have done — and does none of it. This is where the figures below come from. Start here.',
  },
  {
    value: 'act',
    icon: Zap,
    title: 'Acting',
    body: 'Its decisions take effect: which enquiries become leads, who is alerted, how loudly, and what customers are told. Worth moving to once the figures below hold up.',
  },
] as const

export function JudgementModePanel({
  value,
  onChange,
}: {
  value: string
  onChange: (mode: string) => void
}) {
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/judgements/accuracy?days=30', { cache: 'no-store' })
      if (!res.ok) return
      setAccuracy((await res.json()) as Accuracy)
    } catch {
      // Silent. The panel is usable without the figures, and an account
      // that has judged nothing has nothing to show anyway.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasJudged = (accuracy?.judged ?? 0) > 0
  const reviewed = accuracy?.reviewed ?? 0

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50">
          <TrendingUp className="h-4 w-4 text-violet-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-800">
            Letting the assistant decide
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            When it cannot answer a message it reads the conversation once and works out five
            things: whether this is a real enquiry, what it is about, whether you offer it at all,
            how urgent it is, and whether they named a time to be called back.
          </p>

          <div className="mt-4 space-y-2">
            {MODES.map((mode) => {
              const Icon = mode.icon
              const active = value === mode.value
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => onChange(mode.value)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-violet-300 bg-violet-50/60'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                      active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800">
                      {mode.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">
                      {mode.body}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Said plainly rather than left for somebody to discover: a
              switch that spends money should say so where it is
              flipped. */}
          {value !== 'off' && (
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              This reads each handover once with a small model. On a normal day that is a rupee or
              two; it appears on the Usage screen as <span className="font-medium">judgement</span>.
            </p>
          )}

          {/* ── The evidence ── */}
          {loading ? (
            <div className="mt-5 flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
            </div>
          ) : hasJudged ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-[12.5px] font-semibold text-slate-700">
                The last {accuracy!.days} days, on your own messages
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Figure
                  label="Decisions made"
                  value={String(accuracy!.judged)}
                  hint={accuracy!.acted > 0 ? `${accuracy!.acted} acted on` : 'watching only'}
                />
                <Figure
                  label="Right about leads"
                  value={accuracy!.lead_percent === null ? '—' : `${accuracy!.lead_percent}%`}
                  hint={reviewed > 0 ? `of ${reviewed} answered` : 'nobody has answered any yet'}
                />
                <Figure
                  label="Right about subject"
                  value={
                    accuracy!.category_percent === null ? '—' : `${accuracy!.category_percent}%`
                  }
                  hint={
                    accuracy!.category_judged > 0
                      ? `of ${accuracy!.category_judged} judged`
                      : 'no subjects set yet'
                  }
                />
              </div>

              {/* Both percentages are blank until somebody reviews. Said
                  out loud, because a blank figure looks like a bug. */}
              {reviewed === 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
                  Nothing has been reviewed yet, so there is no accuracy to show. Answer a few on
                  the <span className="font-medium">To review</span> tab and these fill in — an
                  unanswered decision counts for neither side, deliberately.
                </p>
              )}

              {accuracy!.confusion.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11.5px] font-medium text-slate-600">
                    Subjects it keeps mixing up
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {accuracy!.confusion.map((c, i) => (
                      <p key={i} className="text-[11.5px] text-slate-500">
                        Said <span className="font-medium text-slate-700">{c.said}</span>, was{' '}
                        <span className="font-medium text-slate-700">{c.was}</span> —{' '}
                        <span className="tabular-nums">{c.count}×</span>
                      </p>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                    One line in each of those two categories saying where one ends fixes this
                    better than anything else can.
                  </p>
                </div>
              )}

              {accuracy!.missed.length > 0 && (
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    Real enquiries it dismissed as
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {accuracy!.missed.map((m, i) => (
                      <p key={i} className="text-[11.5px] text-slate-500">
                        {MISSED_LABELS[m.reason] ?? m.reason} —{' '}
                        <span className="tabular-nums">{m.count}×</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {value === 'observe' && (
                <p className="mt-4 rounded-lg bg-white px-3 py-2 text-[11.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
                  Had it been acting, it would have made{' '}
                  <span className="font-medium">{accuracy!.would_have.created_leads}</span> leads,
                  interrupted somebody urgently{' '}
                  <span className="font-medium">{accuracy!.would_have.alerted_urgently}</span>{' '}
                  times, and stayed quiet{' '}
                  <span className="font-medium">{accuracy!.would_have.stayed_silent}</span> times.
                </p>
              )}
            </div>
          ) : (
            value !== 'off' && (
              <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
                Nothing judged yet. Figures appear here after the assistant has handed a few
                conversations over.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-slate-800">{value}</p>
      <p className="text-[10.5px] text-slate-400">{hint}</p>
    </div>
  )
}
