"use client"

/**
 * Every ad from click to cash (GET /api/ads/performance): what it cost,
 * who it brought, who was won and what they paid — by campaign and by ad,
 * with up to three findings written by code. Owners and admins only; for
 * anyone else the API says no and this shows nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Lightbulb, Loader2, RefreshCw } from "lucide-react"
import type { AdPerformance, AdRow, CampaignRow, MoneyAmount } from "@/lib/ads/performance"

type Kind = "today" | "week" | "month"
type Response = AdPerformance & { period: { kind: Kind; firstDay: string; lastDay: string } }

const PERIODS: Array<{ key: Kind; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
]
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", lead_form: "Form" }

const n = (v: number) => v.toLocaleString("en-IN")
function cash(v: number | null, currency: string | null): string {
  if (v == null) return "—"
  try {
    return currency ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v) : n(Math.round(v))
  } catch {
    return `${currency ?? ""} ${n(Math.round(v))}`.trim()
  }
}
const revenue = (list: MoneyAmount[]) => (list.length ? list.map((m) => cash(m.amount, m.currency)).join(" + ") : "—")
const roas = (v: number | null) => (v == null ? "—" : `${v.toFixed(v >= 10 ? 0 : 1)}×`)
const adTitle = (a: AdRow) => a.adName ?? a.headline ?? `Ad ${a.adId}`

export function AdsByAd() {
  const [kind, setKind] = useState<Kind>("month")
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"campaigns" | "ads">("campaigns")
  const seq = useRef(0)

  const load = useCallback(async (k: Kind) => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ads/performance?period=${k}`)
      if (mine !== seq.current) return
      // Not an owner/admin, or the Ads page not allowed: this part simply is not theirs.
      if (res.status === 403) { setHidden(true); return }
      const body = (await res.json().catch(() => ({}))) as Response & { error?: string }
      if (!res.ok) throw new Error(body.error || "Could not load ad results. Try again.")
      if (mine === seq.current) setData(body)
    } catch (err) {
      if (mine !== seq.current) return
      console.error("[ads by ad] load failed:", err)
      setError(err instanceof Error && err.message ? err.message : "Could not load ad results. Try again.")
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void load(kind) }, [kind, load])

  if (hidden) return null
  const cur = data?.currency ?? null
  const t = data?.totals

  return (
    <section aria-labelledby="ads-by-ad" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ads-by-ad" className="text-[15px] font-semibold text-slate-900">From click to sale</h2>
          <p className="text-[12px] text-slate-500">Each ad's cost, the people it brought, who was won and what they paid.</p>
        </div>
        <div role="tablist" aria-label="Period" className="flex rounded-lg bg-slate-100 p-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={kind === p.key} onClick={() => setKind(p.key)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${kind === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</span>
          <button type="button" onClick={() => void load(kind)} className="flex items-center gap-1 font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>
        </div>
      ) : loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
      ) : data && t ? (
        <div className={loading ? "opacity-60" : ""} aria-busy={loading}>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Spent", cash(t.spend, cur)],
              ["Came in from ads", n(t.arrivals)],
              ["Leads", n(t.leads)],
              ["Won", n(t.won)],
              ["Cost per lead", cash(t.costPerLead, cur)],
              ["Return on spend", roas(t.roas)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-[11.5px] text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-slate-500">
            Revenue from these leads: {revenue(t.revenue)} · Leads from other sources: {n(data.otherLeads)}
          </p>
          {data.spendMessage && <p className="mt-2 text-[12.5px] text-amber-700">{data.spendMessage}</p>}

          {data.findings.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3">
              {data.findings.map((f) => (
                <li key={f} className="flex gap-2 text-[13px] text-slate-800"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />{f}</li>
              ))}
            </ul>
          )}

          {data.ads.length === 0 ? (
            <p className="mt-6 text-center text-[13px] text-slate-500">No ad brought anyone in this period yet. New ad clicks and form fills appear here by themselves.</p>
          ) : (
            <>
              <div role="tablist" aria-label="Group by" className="mt-5 flex gap-4 border-b border-slate-100">
                {(["campaigns", "ads"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                    className={`-mb-px border-b-2 px-1 pb-2 text-[13px] font-medium ${view === v ? "border-primary text-slate-900" : "border-transparent text-slate-500"}`}>
                    {v === "campaigns" ? `Campaigns (${data.campaigns.length})` : `Ads (${data.ads.length})`}
                  </button>
                ))}
              </div>
              {view === "campaigns" ? <CampaignTable rows={data.campaigns} currency={cur} /> : <AdTable rows={data.ads} currency={cur} />}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Cells({ r, currency }: { r: Pick<CampaignRow, "arrivals" | "leads" | "won" | "revenue" | "spend" | "costPerLead" | "roas">; currency: string | null }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.spend, currency)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.arrivals)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.leads)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.won)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{revenue(r.revenue)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.costPerLead, currency)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{roas(r.roas)}</td>
    </>
  )
}

const HEAD = ["Spent", "Came in", "Leads", "Won", "Revenue", "Per lead", "Return"]

function Table({ first, children }: { first: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] text-slate-700">
        <thead>
          <tr className="text-left text-[11.5px] text-slate-500">
            <th scope="col" className="px-3 py-2 font-medium">{first}</th>
            {HEAD.map((h) => <th key={h} scope="col" className="px-3 py-2 text-right font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

function CampaignTable({ rows, currency }: { rows: CampaignRow[]; currency: string | null }) {
  return (
    <Table first="Campaign">
      {rows.map((c, i) => (
        <tr key={c.campaignId ?? `none-${i}`}>
          <th scope="row" className="max-w-[260px] px-3 py-2.5 text-left font-medium text-slate-900 [overflow-wrap:anywhere]">
            {c.campaignName ?? "Campaign not named yet"}
            <span className="block text-[11.5px] font-normal text-slate-500">{c.ads} {c.ads === 1 ? "ad" : "ads"}</span>
          </th>
          <Cells r={c} currency={currency} />
        </tr>
      ))}
    </Table>
  )
}

function AdTable({ rows, currency }: { rows: AdRow[]; currency: string | null }) {
  return (
    <Table first="Ad">
      {rows.map((a) => (
        <tr key={a.adId} className={a.spend && a.leads === 0 ? "bg-rose-50/50" : undefined}>
          <th scope="row" className="max-w-[260px] px-3 py-2.5 text-left font-medium text-slate-900">
            <span className="flex items-center gap-2">
              {a.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumbnailUrl} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-md object-cover" />
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {adTitle(a)}
                <span className="block text-[11.5px] font-normal text-slate-500 [overflow-wrap:anywhere]">
                  {[a.campaignName, a.channels.map((c) => CHANNEL[c] ?? c).join(", ")].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </span>
          </th>
          <Cells r={a} currency={currency} />
        </tr>
      ))}
    </Table>
  )
}
