"use client"

/**
 * How the assistant is actually doing.
 *
 * Deliberately not a wall of charts. Every figure here answers a question
 * somebody actually asks — how much of the load is the bot carrying, are
 * the customers happy, how often do they give up and ask for a person,
 * and what does the bot keep failing at. A chart would make those harder
 * to read, not easier: none of them is a trend anyone acts on daily.
 *
 * The last table is the point of the page. Questions the chatbot had no
 * flow for, counted, most-asked first — the clearest instruction the app
 * can give about what to build next.
 */

import { useCallback, useEffect, useState } from "react"
import {
  ShieldCheck, Smile, UserRoundSearch, Sparkles,
  MessageCircleQuestion, Loader2, AlertTriangle,
} from "lucide-react"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

interface Summary {
  conversations: number
  contained: number
  escalated: number
  containment_rate: number
  ai_replies: number
  handoffs: number
  escapes: number
  flows_completed: number
  flows_started: number
  csat_asked: number
  csat_answered: number
  csat_average: number | null
}

interface Unanswered {
  question: string
  times: number
  last_asked: string
}

interface Payload {
  days: number
  summary: Summary
  unanswered: Unanswered[]
}

const RANGES = [7, 30, 90] as const

/**
 * The industry's own bands, so a number here means the same thing it
 * means in any vendor's report. Colour never travels alone — it always
 * carries this label.
 */
function containmentBand(rate: number): { label: string; tone: string } {
  if (rate >= 0.6) return { label: "Strong", tone: "text-emerald-700 bg-emerald-50" }
  if (rate >= 0.4) return { label: "Typical", tone: "text-sky-700 bg-sky-50" }
  if (rate >= 0.2) return { label: "Low", tone: "text-amber-700 bg-amber-50" }
  return { label: "Very low", tone: "text-rose-700 bg-rose-50" }
}

function Tile({
  icon, label, value, sub, badge, accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  badge?: { label: string; tone: string }
  accent: string
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accent)}>
          {icon}
        </div>
        {badge && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", badge.tone)}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-[28px] font-bold leading-none tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-[13px] text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">{sub}</p>}
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-100", className)} />
}

export default function AiQualityPage() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (range: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-quality?days=${range}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? "Could not load the figures")
      setData(body as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the figures")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const s = data?.summary
  const band = s ? containmentBand(s.containment_rate) : null
  const csatResponseRate =
    s && s.csat_asked > 0 ? Math.round((s.csat_answered / s.csat_asked) * 100) : null

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Assistant quality</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            How much the assistant handled, how satisfied people were, and what it
            keeps failing at.
          </p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                days === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[136px]" />)}
        </div>
      ) : s ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-50"
              label="Handled without a person"
              value={`${Math.round(s.containment_rate * 100)}%`}
              sub={`${s.contained} of ${s.conversations} conversations`}
              badge={band ?? undefined}
            />
            <Tile
              icon={<Smile className="h-5 w-5 text-sky-600" />}
              accent="bg-sky-50"
              label="Customer satisfaction"
              value={s.csat_average === null ? "—" : `${s.csat_average.toFixed(1)} / 5`}
              sub={
                s.csat_asked === 0
                  ? "Nobody asked yet — close a conversation to ask"
                  : `${s.csat_answered} of ${s.csat_asked} answered${
                      csatResponseRate === null ? "" : ` · ${csatResponseRate}%`
                    }`
              }
            />
            <Tile
              icon={<UserRoundSearch className="h-5 w-5 text-amber-600" />}
              accent="bg-amber-50"
              label="Asked for a person"
              value={String(s.escapes)}
              sub={`${s.handoffs} handed over in total`}
            />
            <Tile
              icon={<Sparkles className="h-5 w-5 text-violet-600" />}
              accent="bg-violet-50"
              label="Answered by AI, not a flow"
              value={String(s.ai_replies)}
              sub={`${s.flows_completed} of ${s.flows_started} chatbot runs finished`}
            />
          </div>

          <section className="mt-8">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-bold text-slate-900">
                Questions with no flow behind them
              </h2>
              <span className="text-[12px] text-slate-400">
                What the customer said just before the AI had to step in
              </span>
            </div>

            {data.unanswered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center">
                <MessageCircleQuestion className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-[13.5px] font-medium text-slate-700">
                  Nothing here
                </p>
                <p className="mt-1 text-[12.5px] text-slate-500">
                  Either every question matched a flow, or the AI has not had to
                  answer anything in this period.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 text-left font-semibold">Question</th>
                      <th className="px-5 py-3 text-right font-semibold whitespace-nowrap">Asked</th>
                      <th className="px-5 py-3 text-right font-semibold whitespace-nowrap">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unanswered.map((q) => (
                      <tr key={q.question} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-3 text-slate-800">{q.question}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {q.times}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-400 whitespace-nowrap">
                          {new Date(q.last_asked).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
              A phrase that keeps coming back here is worth a chatbot flow of its
              own — the AI can answer it, but a flow answers it faster, the same
              way every time, and without spending tokens.
            </p>
          </section>

          <p className="mt-8 flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-500">
            <span>
              <strong className="font-semibold text-slate-700">How to read this.</strong>{" "}
              &ldquo;Handled without a person&rdquo; counts conversations no human
              replied in. It is an operational fact, not a verdict on quality — a
              bot that answered badly and was never escalated counts here too.
              Satisfaction is the figure that checks it, which is why the two sit
              side by side.
            </span>
          </p>
        </>
      ) : !error ? (
        <div className="flex items-center gap-2 text-[13px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}
    </div>
  )
}
