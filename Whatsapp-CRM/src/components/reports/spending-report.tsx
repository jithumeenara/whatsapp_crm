"use client"

/**
 * The Spending report: what the business spent on WhatsApp messages, AI and
 * Meta Ads, by category, number, person, team, channel and day. Every number
 * comes from /api/reports/spending; this file only lays it out.
 *
 * Money in different currencies is never added here: each amount shows in
 * its own currency, and the combined total says what it left out.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { formatAmount, formatCost } from "@/lib/format/money"
import { channelLabel, dayAmount, type Money, type SpendingReport } from "@/lib/reports/spending-assemble"
import { SpendingPdfButton } from "./spending-pdf-button"
import { useCountUp } from "@/hooks/use-count-up"

type Kind = "today" | "week" | "month" | "custom"
type Response = SpendingReport & {
  period: { kind: Kind; firstDay: string; lastDay: string; partial: boolean; timeZone: string }
  warnings: string[]
}

const PERIODS: Array<{ key: Kind; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Dates" },
]
const KINDS: Kind[] = ["today", "week", "month", "custom"]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const CATEGORY: Record<string, string> = {
  marketing: "Marketing",
  utility: "Utility",
  authentication: "Authentication",
  "authentication-international": "Authentication (international)",
  service: "Service",
  referral_conversion: "Free entry point",
}

const FEATURE: Record<string, string> = {
  chat_customer: "Customer chat replies",
  chat_admin: "Admin test chat",
  admin_chat: "Admin chat",
  template_kit: "Template kit",
  translation: "Translation",
  message_polish: "Improve message",
  judgement: "Hand-over judgement",
  lead_detect: "Lead detection",
  embedding: "Knowledge training",
  retrieval: "Knowledge search",
  transcription: "Voice notes to text",
  tts: "Voice replies",
  tts_cloud: "Voice replies (cloud)",
  image_reading: "Reading images",
  file_reading: "Reading files",
  pdf_ocr: "Scanned PDFs",
  sheet_rule: "Sheet rules",
  live_voice: "Live voice",
}

const count = (v: number) => v.toLocaleString("en-IN")

/** "₹86.31", or "₹86.31 + $1.00" when two currencies are present. */
function moneyText(m: Money): string {
  const parts = Object.entries(m).map(([c, a]) => formatAmount(a, c))
  return parts.length ? parts.join(" + ") : "—"
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

function readUrl(): { kind: Kind; from: string; to: string } {
  const q = new URLSearchParams(window.location.search)
  const k = q.get("period") as Kind | null
  const f = q.get("from") ?? ""
  const t = q.get("to") ?? ""
  return { kind: k && KINDS.includes(k) ? k : "month", from: DAY_RE.test(f) ? f : "", to: DAY_RE.test(t) ? t : "" }
}

/** An amount that counts up the first time the report shows it (never for
 *  somebody who asked for less motion, never again on a refresh). */
function AnimatedAmount({ amount, currency }: { amount: number; currency: string }) {
  const shown = useCountUp(amount)
  return <>{formatAmount(shown, currency)}</>
}

function Kpi({ label, value, sub, index = 0 }: { label: string; value: React.ReactNode; sub?: string; index?: number }) {
  return (
    // Each card eases in a moment after the one before it: opacity and
    // position only, 400 ms in all. The app's CSS cancels it for reduced motion.
    <div
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-300 min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-[18px] font-bold leading-tight tabular-nums text-slate-900 [overflow-wrap:anywhere] sm:text-[22px]">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
      {hint && <p className="mt-0.5 text-[11.5px] text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ children = "Nothing in this period." }: { children?: React.ReactNode }) {
  return <p className="text-[12.5px] text-slate-500">{children}</p>
}

function Row({ label, right, value, max, sub }: { label: string; right: string; value: number; max: number; sub?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">{label}</span>
        <span className="shrink-0 text-right tabular-nums text-slate-600">{right}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${w}%` }} />
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </li>
  )
}

/** The value a bar is drawn from: the business currency when present, else the largest. */
function barValue(m: Money, business: string): number {
  if (business in m) return m[business]
  const v = Object.values(m)
  return v.length ? Math.max(...v) : 0
}

function DailyChart({ data }: { data: Response }) {
  const business = data.businessCurrency
  const aiRate = data.ai.inBusinessCurrency?.rate ?? null
  const days = data.byDay.map((d) => {
    const wa = dayAmount(d.whatsapp, business)
    const ai = aiRate !== null ? d.aiUsd * aiRate : 0
    return { day: d.day, wa, ai, total: wa + ai }
  })
  const max = Math.max(0.0001, ...days.map((d) => d.total))
  if (days.length === 0) return <Empty />
  return (
    <div>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={`Daily spend in ${business}, WhatsApp and AI, ${days.length} days`}>
        {days.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${dayLabel(d.day)}: ${formatAmount(d.total, business)}`}>
            <div className="w-full bg-emerald-500" style={{ height: `${(d.ai / max) * 100}%` }} />
            <div className="w-full rounded-t-sm bg-primary" style={{ height: `${(d.wa / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-slate-400">
        <span>{dayLabel(days[0].day)}</span>
        {days.length > 1 && <span>{dayLabel(days[days.length - 1].day)}</span>}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />WhatsApp messages</span>
        {aiRate !== null && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />AI (estimated)</span>}
      </p>
      <table className="sr-only">
        <caption>Daily spend</caption>
        <thead><tr><th>Day</th><th>WhatsApp</th><th>AI</th></tr></thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{formatAmount(d.wa, business)}</td><td>{formatAmount(d.ai, business)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SpendingReportView() {
  const [kind, setKind] = useState<Kind>("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [urlRead, setUrlRead] = useState(false)
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  // Read after mount, so the server's render and the first browser render agree.
  useEffect(() => {
    const u = readUrl()
    setKind(u.kind)
    setFrom(u.from)
    setTo(u.to)
    setUrlRead(true)
  }, [])

  useEffect(() => {
    if (!urlRead) return
    const q = new URLSearchParams(window.location.search)
    q.set("period", kind)
    if (kind === "custom" && from) q.set("from", from); else q.delete("from")
    if (kind === "custom" && to) q.set("to", to); else q.delete("to")
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`)
  }, [kind, from, to, urlRead])

  const load = useCallback(async () => {
    if (!urlRead) return
    if (kind === "custom" && (!from || !to)) return
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ period: kind })
      if (kind === "custom") { qs.set("from", from); qs.set("to", to) }
      const res = await apiFetch(`/api/reports/spending?${qs}`)
      const body = (await res.json()) as Response
      if (mine !== seq.current) return
      setData(body)
    } catch (err) {
      console.error("[spending] load failed:", err)
      if (mine === seq.current) setError(errorText(err, "Could not load the spending report. Try again."))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [kind, from, to, urlRead])

  useEffect(() => { void load() }, [load])

  const business = data?.businessCurrency ?? "INR"
  const notes = data ? [...data.warnings, ...data.totals.excluded] : []
  const maxCat = Math.max(0, ...(data?.whatsapp.byCategory.map((c) => barValue(c.amount, business)) ?? [0]))
  const maxNum = Math.max(0, ...(data?.whatsapp.byNumber.map((c) => barValue(c.amount, business)) ?? [0]))
  const maxPerson = Math.max(0, ...(data?.whatsapp.byPerson.map((c) => barValue(c.amount, business)) ?? [0]))
  const maxFeature = Math.max(0, ...(data?.ai.byFeature.map((f) => f.costUsd) ?? [0]))
  const maxAiPerson = Math.max(0, ...(data?.ai.byPerson.map((p) => p.costUsd) ?? [0]))
  const ai = data?.ai
  const aiText = ai ? (ai.inBusinessCurrency ? formatAmount(ai.inBusinessCurrency.amount, ai.inBusinessCurrency.currency) : formatCost(ai.costUsd, "USD")) : "—"

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900">Spending</h1>
          <p className="text-[12px] text-slate-500">
            {data
              ? `${data.period.firstDay === data.period.lastDay ? dayLabel(data.period.firstDay) : `${dayLabel(data.period.firstDay)} to ${dayLabel(data.period.lastDay)}`} · ${data.period.timeZone}${data.period.partial ? " · so far" : ""}`
              : "WhatsApp messages, AI and Meta Ads"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Period" className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={kind === p.key} onClick={() => setKind(p.key)}
                className={`min-h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${kind === p.key ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <SpendingPdfButton period={kind} from={from} to={to} disabled={loading || (kind === "custom" && (!from || !to))} />
          <button type="button" onClick={() => void load()} aria-label="Refresh spending report" disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {kind === "custom" && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <label className="text-[12px] text-slate-600">From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-200 px-3 text-[13px]" />
          </label>
          <label className="text-[12px] text-slate-600">To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-200 px-3 text-[13px]" />
          </label>
          {(!from || !to) && <p className="text-[12px] text-slate-500">Choose both days to see the report.</p>}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error} <button type="button" onClick={() => void load()} className="font-medium underline">Try again</button></span>
        </div>
      )}

      {!data && loading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      )}

      {data && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi
              index={0}
              label="Total spend"
              value={<AnimatedAmount amount={data.totals.combined} currency={business} />}
              sub={data.totals.excluded.length ? "Some amounts left out, see below" : "WhatsApp, AI and Meta Ads"}
            />
            <Kpi
              index={1}
              label="WhatsApp messages"
              value={Object.keys(data.whatsapp.total).length === 1 ? <AnimatedAmount amount={Object.values(data.whatsapp.total)[0]} currency={Object.keys(data.whatsapp.total)[0]} /> : moneyText(data.whatsapp.total)}
              sub={`${count(data.whatsapp.delivered)} delivered · ${count(data.whatsapp.free)} free`}
            />
            <Kpi
              index={2}
              label="AI (estimated)"
              value={ai ? <AnimatedAmount amount={ai.inBusinessCurrency ? ai.inBusinessCurrency.amount : ai.costUsd} currency={ai.inBusinessCurrency ? ai.inBusinessCurrency.currency : "USD"} /> : aiText}
              sub={`Calls: ${count(data.ai.calls)}${data.ai.inBusinessCurrency?.currency === "INR" ? ` · at ₹${data.ai.inBusinessCurrency.rate}/$` : ""}`}
            />
            <Kpi
              index={3}
              label="Meta Ads"
              value={!data.ads.connected ? "Not connected" : data.ads.spend === null ? "Not available" : <AnimatedAmount amount={data.ads.spend} currency={data.ads.currency ?? business} />}
              sub={data.ads.error ?? (data.ads.connected ? `Clicks: ${count(data.ads.clicks)}` : "Connect it in Settings → Ads")}
            />
            <Kpi
              index={4}
              label="Cost per lead"
              value={data.outcomes.costPerLead === null ? "—" : <AnimatedAmount amount={data.outcomes.costPerLead} currency={business} />}
              sub={`Leads in this period: ${count(data.outcomes.leads)}`}
            />
            <Kpi
              index={5}
              label="Cost per won deal"
              value={data.outcomes.costPerWon === null ? "—" : <AnimatedAmount amount={data.outcomes.costPerWon} currency={business} />}
              sub={`Deals won: ${count(data.outcomes.wonDeals)}`}
            />
          </div>

          {notes.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-[12.5px] text-amber-900">
              {notes.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Section title="Spend by day" hint="WhatsApp messages and AI, in your business currency.">
              <DailyChart data={data} />
            </Section>

            <Section title="WhatsApp by category" hint="What Meta charged for delivered messages. Free messages cost nothing.">
              {data.whatsapp.byCategory.length === 0 ? <Empty /> : (
                <ul className="space-y-2.5">
                  {data.whatsapp.byCategory.map((c) => {
                    const free = (c.type ?? "").startsWith("free")
                    const label = `${CATEGORY[c.category ?? ""] ?? c.category ?? "Unknown"}${free ? " (free)" : ""}`
                    return <Row key={`${c.category}|${c.type}`} label={label} value={barValue(c.amount, business)} max={maxCat}
                      right={`${count(c.count)} · ${free ? "free" : moneyText(c.amount)}`}
                      sub={c.unpriced ? `${count(c.unpriced)} with no price yet` : undefined} />
                  })}
                </ul>
              )}
            </Section>

            <Section title="WhatsApp by number">
              {data.whatsapp.byNumber.length === 0 ? <Empty /> : (
                <ul className="space-y-2.5">
                  {data.whatsapp.byNumber.map((c) => <Row key={c.id ?? "none"} label={c.label} value={barValue(c.amount, business)} max={maxNum} right={`${count(c.count)} · ${moneyText(c.amount)}`} />)}
                </ul>
              )}
            </Section>

            <Section title="WhatsApp by person" hint="Who sent the messages. The AI assistant and the system are listed on their own.">
              {data.whatsapp.byPerson.length === 0 ? <Empty /> : (
                <ul className="space-y-2.5">
                  {data.whatsapp.byPerson.map((p) => <Row key={p.userId ?? p.name} label={p.name} value={barValue(p.amount, business)} max={maxPerson} right={`${count(p.count)} · ${moneyText(p.amount)}`} />)}
                </ul>
              )}
            </Section>

            <Section title="By team" hint="People's messages and AI help added up by team. Set a person's team in Settings → Members.">
              {data.byTeam.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[320px] text-left text-[12.5px]">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                      <tr><th scope="col" className="py-1 pr-3 font-semibold">Team</th><th scope="col" className="py-1 pr-3 text-right font-semibold">People</th><th scope="col" className="py-1 pr-3 text-right font-semibold">WhatsApp</th><th scope="col" className="py-1 text-right font-semibold">AI (USD)</th></tr>
                    </thead>
                    <tbody>
                      {data.byTeam.map((t) => (
                        <tr key={t.team} className="border-t border-slate-100">
                          <th scope="row" className="py-1.5 pr-3 font-medium text-slate-700 [overflow-wrap:anywhere]">{t.team}</th>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{count(t.people)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{moneyText(t.whatsapp)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatCost(t.aiUsd, "USD")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="By channel" hint="WhatsApp messages, and AI help on each channel.">
              {data.byChannel.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[300px] text-left text-[12.5px]">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                      <tr><th scope="col" className="py-1 pr-3 font-semibold">Channel</th><th scope="col" className="py-1 pr-3 text-right font-semibold">Messages</th><th scope="col" className="py-1 text-right font-semibold">AI (USD)</th></tr>
                    </thead>
                    <tbody>
                      {data.byChannel.map((c) => (
                        <tr key={c.channel} className="border-t border-slate-100">
                          <th scope="row" className="py-1.5 pr-3 font-medium text-slate-700">{channelLabel(c.channel)}</th>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{moneyText(c.messages)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatCost(c.aiUsd, "USD")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="AI by feature" hint="Estimated from the provider's own token counts. Shown in US dollars.">
              {data.ai.byFeature.length === 0 ? <Empty /> : (
                <ul className="space-y-2.5">
                  {data.ai.byFeature.map((f) => <Row key={f.feature} label={FEATURE[f.feature] ?? f.feature.replace(/_/g, " ")} value={f.costUsd} max={maxFeature} right={`${count(f.calls)} · ${formatCost(f.costUsd, "USD")}`} />)}
                </ul>
              )}
            </Section>

            <Section title="AI by person" hint="Whose action started the AI work. Work done for nobody in particular is listed as not attributed.">
              {data.ai.byPerson.length === 0 ? <Empty /> : (
                <ul className="space-y-2.5">
                  {data.ai.byPerson.map((p) => <Row key={p.userId ?? "none"} label={p.name} value={p.costUsd} max={maxAiPerson} right={`${count(p.calls)} · ${formatCost(p.costUsd, "USD")}`} />)}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
