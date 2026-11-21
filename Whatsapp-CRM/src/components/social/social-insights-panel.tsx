"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2, Table2, LineChart } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"

type Channel = "instagram" | "facebook"
interface Insights {
  counts: { followers: number | null; follows: number | null; media: number | null }
  totals: Record<string, number>
  history: Array<{ day: string; followers: number }>
  audience: Record<"age" | "gender" | "city", Array<{ label: string; value: number }>> | null
}

const LABELS: Record<string, string> = {
  reach: "Accounts reached",
  views: "Views",
  accounts_engaged: "Accounts engaged",
  total_interactions: "Interactions",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  follows_and_unfollows: "Follows",
  page_media_view: "Views",
  page_total_media_view_unique: "People reached",
  page_post_engagements: "Post engagements",
  page_daily_follows_unique: "New follows",
  page_daily_unfollows_unique: "Unfollows",
}

const fmt = (n: number) => new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n)
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })

/** Followers, period totals and (Instagram) audience — numbers only. */
export function SocialInsightsPanel({ channel }: { channel: Channel }) {
  const [days, setDays] = useState<7 | 30>(7)
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const body = (await (await apiFetch(`/api/social/insights?channel=${channel}&days=${days}`)).json()) as Insights
      if (seq !== loadSeq.current) return
      setData({
        counts: body.counts ?? { followers: null, follows: null, media: null },
        totals: body.totals && typeof body.totals === "object" ? body.totals : {},
        history: Array.isArray(body.history) ? body.history : [],
        audience: body.audience ?? null,
      })
      setFailed(false)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[social insights] load failed:", err)
      setFailed(true)
      toast.error(errorText(err, "Could not load insights."))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [channel, days])

  useEffect(() => { void load() }, [load])

  const totals = Object.entries(data?.totals ?? {}).filter(([k]) => LABELS[k])

  return (
    <section aria-labelledby={`insights-${channel}`} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`insights-${channel}`} className="text-[15px] font-semibold text-slate-800">Insights</h2>
        <div role="tablist" aria-label="Period" className="flex rounded-lg border border-slate-200 p-0.5">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium ${days === d ? "bg-primary text-primary-foreground" : "text-slate-600 hover:bg-slate-50"}`}>
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10 text-slate-400" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div>
      ) : failed && !data ? (
        <p className="py-8 text-center text-sm text-slate-500">Could not load insights. <button type="button" onClick={() => void load()} className="font-semibold text-slate-800 underline">Try again</button></p>
      ) : data ? (
        <div className="mt-4 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Followers" value={data.counts.followers} />
            {channel === "instagram" && <Tile label="Following" value={data.counts.follows} />}
            {channel === "instagram" && <Tile label="Posts" value={data.counts.media} />}
            {totals.map(([k, v]) => <Tile key={k} label={LABELS[k]} value={v} hint={`last ${days} days`} />)}
          </div>
          {totals.length === 0 && (
            <p className="text-[12px] text-slate-500">Meta did not return period numbers. Insights need the insights permission for your Meta app{channel === "instagram" ? " and a professional account" : ""}.</p>
          )}

          <FollowerChart history={data.history} />

          {channel === "instagram" && data.audience && (
            <div className="grid gap-5 md:grid-cols-3">
              <Bars title="Age" rows={data.audience.age} />
              <Bars title="Gender" rows={data.audience.gender.map((r) => ({ ...r, label: r.label === "F" ? "Women" : r.label === "M" ? "Men" : r.label === "U" ? "Not given" : r.label }))} />
              <Bars title="Top cities" rows={data.audience.city} />
            </div>
          )}
          {channel === "instagram" && data.audience && !data.audience.age.length && !data.audience.city.length && (
            <p className="text-[12px] text-slate-500">Audience details appear once the account has at least 100 followers (Meta&apos;s rule).</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Tile({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[11.5px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value === null ? "—" : fmt(value)}</p>
      {hint && <p className="text-[10.5px] text-slate-400">{hint}</p>}
    </div>
  )
}

/** One series (followers by day): 2px line, hover crosshair + tooltip, table view. */
function FollowerChart({ history }: { history: Array<{ day: string; followers: number }> }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const W = 640, H = 180, PAD = { l: 44, r: 12, t: 12, b: 24 }

  if (history.length < 2) {
    return (
      <div>
        <h3 className="text-[13px] font-semibold text-slate-700">Follower growth</h3>
        <p className="mt-1 text-[12px] text-slate-500">The CRM records the follower count once a day. The chart appears after the second day.</p>
      </div>
    )
  }
  const vals = history.map((h) => h.followers)
  let min = Math.min(...vals), max = Math.max(...vals)
  if (min === max) { min -= 1; max += 1 }
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (history.length - 1)
  const y = (v: number) => PAD.t + ((max - v) * (H - PAD.t - PAD.b)) / (max - min)
  const path = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.followers).toFixed(1)}`).join(" ")
  const change = vals[vals.length - 1] - vals[0]
  const ticks = [min, (min + max) / 2, max]

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (history.length - 1))
    setHover(Math.max(0, Math.min(history.length - 1, i)))
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-700">
          Follower growth <span className="font-normal text-slate-500">· {change >= 0 ? "+" : "−"}{fmt(Math.abs(change))} since {dayLabel(history[0].day)}</span>
        </h3>
        <button type="button" onClick={() => setAsTable((t) => !t)} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-600 hover:text-slate-900">
          {asTable ? <><LineChart className="h-3.5 w-3.5" aria-hidden /> Chart</> : <><Table2 className="h-3.5 w-3.5" aria-hidden /> Table</>}
        </button>
      </div>
      {asTable ? (
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-1.5 font-medium">Day</th><th className="px-3 py-1.5 text-right font-medium">Followers</th></tr></thead>
            <tbody>{[...history].reverse().map((h) => <tr key={h.day} className="border-t border-slate-100"><td className="px-3 py-1.5">{dayLabel(h.day)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(h.followers)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" role="img"
            aria-label={`Followers from ${fmt(vals[0])} on ${dayLabel(history[0].day)} to ${fmt(vals[vals.length - 1])} on ${dayLabel(history[history.length - 1].day)}`}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-slate-100" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{fmt(Math.round(t))}</text>
              </g>
            ))}
            <text x={PAD.l} y={H - 6} className="fill-slate-400 text-[10px]">{dayLabel(history[0].day)}</text>
            <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-slate-400 text-[10px]">{dayLabel(history[history.length - 1].day)}</text>
            <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="stroke-slate-300" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(history[hover].followers)} r={4.5} fill="var(--primary)" className="stroke-white" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hover !== null && (
            <div role="status" className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] shadow-sm"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > history.length / 2 ? "-105%" : "5%"})` }}>
              <span className="text-slate-500">{dayLabel(history[hover].day)}</span>{" "}
              <span className="font-semibold tabular-nums text-slate-900">{fmt(history[hover].followers)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Share of followers per group; one hue (identity is the label). */
function Bars({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!rows.length || !total) return null
  const max = Math.max(...rows.map((r) => r.value))
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-slate-700">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="text-[12px]" title={`${r.label}: ${fmt(r.value)} followers`}>
            <div className="flex justify-between gap-2"><span className="truncate text-slate-600">{r.label}</span><span className="tabular-nums text-slate-500">{Math.round((r.value / total) * 100)}%</span></div>
            <div className="mt-0.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: "var(--primary)" }} /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
