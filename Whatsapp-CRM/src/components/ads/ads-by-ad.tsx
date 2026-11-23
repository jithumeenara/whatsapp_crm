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
type Response = AdPerformance & { period: { kind: Kind; firstDay: string; lastDay: string }; adAccounts?: Array<{ id: string; name: string | null; currency: string | null }>; account?: string | null }

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
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`)
const cents = (v: number | null, currency: string | null) => {
  if (v == null) return "—"
  try {
    return currency ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v) : v.toFixed(2)
  } catch {
    return v.toFixed(2)
  }
}
const STATUS: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "Running", cls: "bg-emerald-50 text-emerald-800" },
  PAUSED: { text: "Paused", cls: "bg-slate-100 text-slate-700" },
  CAMPAIGN_PAUSED: { text: "Campaign paused", cls: "bg-slate-100 text-slate-700" },
  ADSET_PAUSED: { text: "Ad set paused", cls: "bg-slate-100 text-slate-700" },
  IN_PROCESS: { text: "In review", cls: "bg-amber-50 text-amber-900" },
  PENDING_REVIEW: { text: "In review", cls: "bg-amber-50 text-amber-900" },
  DISAPPROVED: { text: "Rejected", cls: "bg-rose-50 text-rose-800" },
  WITH_ISSUES: { text: "Has issues", cls: "bg-rose-50 text-rose-800" },
  ARCHIVED: { text: "Archived", cls: "bg-slate-100 text-slate-500" },
}
/** Meta's events, biggest first, as one short line. */
const eventLine = (ev: Record<string, number> | undefined, max = 4) =>
  Object.entries(ev ?? {}).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, v]) => `${k} ${n(v)}`).join(" · ")
const adTitle = (a: AdRow) => a.adName ?? a.headline ?? `Ad ${a.adId}`

export function AdsByAd() {
  const [kind, setKind] = useState<Kind>("month")
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"campaigns" | "ads">("campaigns")
  const [account, setAccount] = useState<string>("")
  const seq = useRef(0)

  const load = useCallback(async (k: Kind, acct: string) => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ads/performance?period=${k}${acct ? `&account=${encodeURIComponent(acct)}` : ""}`)
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

  useEffect(() => { void load(kind, account) }, [kind, account, load])

  if (hidden) return null
  const cur = data?.currency ?? null
  const t = data?.totals

  return (
    <section aria-labelledby="ads-by-ad" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ads-by-ad" className="text-[15px] font-semibold text-slate-900">From click to sale</h2>
          <p className="text-[12px] text-slate-500">Each ad&apos;s cost, the people it brought, who was won and what they paid.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {data?.adAccounts && data.adAccounts.length > 1 && (
          <select aria-label="Ad account" value={account} onChange={(e) => setAccount(e.target.value)}
            className="h-8 max-w-[220px] truncate rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] text-slate-700">
            <option value="">All ad accounts</option>
            {data.adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name ?? `Ad account ${a.id}`}{a.currency ? ` (${a.currency})` : ""}</option>)}
          </select>
        )}
        <div role="tablist" aria-label="Period" className="flex rounded-lg bg-slate-100 p-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={kind === p.key} onClick={() => setKind(p.key)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${kind === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {p.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</span>
          <button type="button" onClick={() => void load(kind, account)} className="flex items-center gap-1 font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>
        </div>
      ) : loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
      ) : data && t ? (
        <div className={loading ? "opacity-60" : ""} aria-busy={loading}>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["Spent", cash(t.spend, cur)],
              ["Came in from ads", n(t.arrivals)],
              ["Leads", n(t.leads)],
              ["Qualified", n(t.qualified ?? 0)],
              ["Won", n(t.won)],
              ["Cost per lead", cash(t.costPerLead, cur)],
              ["Cost per qualified lead", cash(t.costPerQualified ?? null, cur)],
              ["Cost per sale", cash(t.costPerSale ?? null, cur)],
              ["Impressions", t.impressions == null ? "—" : n(t.impressions)],
              ["Clicks", t.clicks == null ? "—" : n(t.clicks)],
              ["CTR", pct(t.ctr ?? null)],
              ["CPC", cents(t.cpc ?? null, cur)],
              ["CPM", cents(t.cpm ?? null, cur)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-[11.5px] text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-slate-500">
            Revenue from these leads: {revenue(t.revenue)} · Return on spend: {roas(t.roas)} · Leads from other sources: {n(data.otherLeads)}
          </p>
          {t.events && Object.keys(t.events).length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-100 px-3 py-2.5">
              <p className="text-[11.5px] font-medium text-slate-500">Events recorded by Meta</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(t.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-700"><span className="tabular-nums font-semibold">{n(v)}</span> {k}</li>
                ))}
              </ul>
            </div>
          )}
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

function Cells({ r, currency }: { r: Pick<CampaignRow, "arrivals" | "leads" | "qualified" | "won" | "revenue" | "spend" | "clicks" | "impressions" | "ctr" | "cpc" | "cpm" | "costPerLead" | "costPerQualified" | "costPerSale" | "roas"> & { currency?: string | null }; currency: string | null }) {
  // An ad shows money in its own ad account's currency.
  const cur = r.currency ?? currency
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.spend, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{r.impressions == null ? "—" : n(r.impressions)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{r.clicks == null ? "—" : n(r.clicks)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.ctr ?? null)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cents(r.cpc ?? null, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cents(r.cpm ?? null, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.arrivals)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.leads)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.qualified ?? 0)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{n(r.won)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{revenue(r.revenue)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.costPerLead, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.costPerQualified ?? null, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{cash(r.costPerSale ?? null, cur)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{roas(r.roas)}</td>
    </>
  )
}

const HEAD = ["Spent", "Impressions", "Clicks", "CTR", "CPC", "CPM", "Came in", "Leads", "Qualified", "Won", "Revenue", "Per lead", "Per qualified", "Per sale", "Return"]

function Table({ first, children }: { first: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1400px] text-[12.5px] text-slate-700">
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
            {eventLine(c.events) && <span className="block text-[11.5px] font-normal text-slate-500">{eventLine(c.events)}</span>}
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
                {a.status && (
                  <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${STATUS[a.status]?.cls ?? "bg-slate-100 text-slate-600"}`}>{STATUS[a.status]?.text ?? a.status.toLowerCase().replace(/_/g, " ")}</span>
                )}
                {eventLine(a.events) && <span className="block text-[11.5px] font-normal text-slate-500">{eventLine(a.events)}</span>}
              </span>
            </span>
          </th>
          <Cells r={a} currency={currency} />
        </tr>
      ))}
    </Table>
  )
}
