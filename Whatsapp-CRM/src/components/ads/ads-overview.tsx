"use client"

/**
 * The Ads page body (GET /api/ads/performance): four headline numbers, a
 * quiet list of campaigns or ads with only their key numbers, and a profile
 * panel per campaign / ad with everything else — delivery, the funnel from
 * impression to sale with the cost of each step, Meta's events, revenue and
 * (for a campaign) its ads. Period, ad account, list, search, sort and the
 * open profile live in the URL, so a view can be shared and survives a
 * reload. Owners and admins only; for anyone else the API says no and this
 * shows nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ChevronRight, Lightbulb, Loader2, RefreshCw, Search } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { AdPerformance, AdRow, CampaignRow, MoneyAmount } from "@/lib/ads/performance"

type Kind = "today" | "week" | "month"
type View = "campaigns" | "ads"
type Sort = "spend" | "leads" | "cpl" | "won"
type Data = AdPerformance & {
  period: { kind: Kind; firstDay: string; lastDay: string }
  adAccounts?: Array<{ id: string; name: string | null; currency: string | null }>
}

const PERIODS: Array<{ key: Kind; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
]
const SORTS: Array<{ key: Sort; label: string }> = [
  { key: "spend", label: "Most spent" },
  { key: "leads", label: "Most leads" },
  { key: "cpl", label: "Cheapest lead" },
  { key: "won", label: "Most won" },
]
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", lead_form: "Form" }
const STATUS: Record<string, { text: string; dot: string }> = {
  ACTIVE: { text: "Running", dot: "bg-emerald-500" },
  PAUSED: { text: "Paused", dot: "bg-slate-400" },
  CAMPAIGN_PAUSED: { text: "Campaign paused", dot: "bg-slate-400" },
  ADSET_PAUSED: { text: "Ad set paused", dot: "bg-slate-400" },
  IN_PROCESS: { text: "In review", dot: "bg-amber-500" },
  PENDING_REVIEW: { text: "In review", dot: "bg-amber-500" },
  DISAPPROVED: { text: "Rejected", dot: "bg-rose-500" },
  WITH_ISSUES: { text: "Has issues", dot: "bg-rose-500" },
  ARCHIVED: { text: "Archived", dot: "bg-slate-300" },
}

// ── formatting ──────────────────────────────────────────────────────────
const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN"))
function money(v: number | null | undefined, currency: string | null, digits = 0): string {
  if (v == null) return "—"
  try {
    return currency ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: digits }).format(v) : v.toLocaleString("en-IN", { maximumFractionDigits: digits })
  } catch {
    return `${currency ?? ""} ${v.toLocaleString("en-IN", { maximumFractionDigits: digits })}`.trim()
  }
}
const revenue = (list: MoneyAmount[]) => (list.length ? list.map((m) => money(m.amount, m.currency)).join(" + ") : "—")
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(v >= 10 ? 1 : 2)}%`)
const roas = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(v >= 10 ? 0 : 1)}×`)
const rate = (part: number | null | undefined, whole: number | null | undefined) => (part != null && whole ? (part / whole) * 100 : null)
const adTitle = (a: AdRow) => a.adName ?? a.headline ?? `Ad ${a.adId}`
const campaignKey = (c: { campaignId: string | null; campaignName: string | null }) => c.campaignId ?? `name:${c.campaignName ?? ""}`

function StatusDot({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const s = STATUS[status]
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
      <span className={`h-1.5 w-1.5 rounded-full ${s?.dot ?? "bg-slate-300"}`} aria-hidden="true" />
      {s?.text ?? status.toLowerCase().replace(/_/g, " ")}
    </span>
  )
}

// ── the page body ───────────────────────────────────────────────────────
export function AdsOverview() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const kind = (["today", "week", "month"] as const).find((k) => k === params.get("period")) ?? "month"
  const view: View = params.get("view") === "ads" ? "ads" : "campaigns"
  const sort = (SORTS.map((s) => s.key) as string[]).includes(params.get("sort") ?? "") ? (params.get("sort") as Sort) : "spend"
  const account = /^\d{1,30}$/.test(params.get("account") ?? "") ? (params.get("account") as string) : ""
  const open = params.get("open") ?? ""
  const [query, setQuery] = useState(params.get("q") ?? "")

  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router])

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ads/performance?period=${kind}${account ? `&account=${encodeURIComponent(account)}` : ""}`)
      if (mine !== seq.current) return
      // Not an owner/admin, or the Ads page not allowed: this part simply is not theirs.
      if (res.status === 403) { setHidden(true); return }
      const body = (await res.json().catch(() => ({}))) as Data & { error?: string }
      if (!res.ok) throw new Error(body.error || "Could not load ad results. Try again.")
      if (mine === seq.current) setData(body)
    } catch (err) {
      if (mine !== seq.current) return
      console.error("[ads] load failed:", err)
      setError(err instanceof Error && err.message ? err.message : "Could not load ad results. Try again.")
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [kind, account])
  useEffect(() => { void load() }, [load])

  // Search: typed text goes to the URL after a short pause (filtering is local).
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get("q") ?? "") !== query.trim()) setParam({ q: query.trim() || null }) }, 300)
    return () => clearTimeout(t)
  }, [query, params, setParam])

  const cur = data?.currency ?? null
  const q = (params.get("q") ?? "").toLowerCase()

  const campaigns = useMemo(() => {
    const list = (data?.campaigns ?? []).filter((c) => !q || (c.campaignName ?? "").toLowerCase().includes(q))
    return sortRows(list, sort)
  }, [data, q, sort])
  const ads = useMemo(() => {
    const list = (data?.ads ?? []).filter((a) => !q || [adTitle(a), a.campaignName ?? "", a.adsetName ?? ""].some((s) => s.toLowerCase().includes(q)))
    return sortRows(list, sort)
  }, [data, q, sort])

  const openCampaign = open.startsWith("campaign:") ? data?.campaigns.find((c) => campaignKey(c) === open.slice(9)) ?? null : null
  const openAd = open.startsWith("ad:") ? data?.ads.find((a) => a.adId === open.slice(3)) ?? null : null

  if (hidden) return null
  const t = data?.totals

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Period" className="flex rounded-lg bg-slate-100 p-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={kind === p.key} onClick={() => setParam({ period: p.key === "month" ? null : p.key, open: null })}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${kind === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {data?.adAccounts && data.adAccounts.length > 1 && (
          <select aria-label="Ad account" value={account} onChange={(e) => setParam({ account: e.target.value || null, open: null })}
            className="h-8 max-w-[220px] truncate rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] text-slate-700">
            <option value="">All ad accounts</option>
            {data.adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name ?? `Ad account ${a.id}`}{a.currency ? ` (${a.currency})` : ""}</option>)}
          </select>
        )}
        {loading && data && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</span>
          <button type="button" onClick={() => void load()} className="flex items-center gap-1 font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>
        </div>
      ) : !data || !t ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading ad results">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[88px] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : (
        <>
          {/* Four headline numbers */}
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Spent" value={money(t.spend, cur)} sub={t.impressions != null ? `${n(t.impressions)} impressions` : undefined} />
            <Kpi label="Leads" value={n(t.leads)} sub={`${n(t.qualified)} qualified · ${n(t.won)} won`} />
            <Kpi label="Cost per lead" value={money(t.costPerLead, cur)} sub={t.costPerQualified != null ? `${money(t.costPerQualified, cur)} per qualified` : undefined} />
            <Kpi label="Cost per sale" value={money(t.costPerSale, cur)} sub={t.roas != null ? `${roas(t.roas)} return on spend` : undefined} />
          </dl>

          {data.spendMessage && <p className="text-[12.5px] text-amber-800">{data.spendMessage}</p>}
          {data.findings.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-amber-50/70 px-4 py-3">
              {data.findings.map((f) => (
                <li key={f} className="flex gap-2 text-[13px] text-slate-800"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />{f}</li>
              ))}
            </ul>
          )}

          {/* The list */}
          <section aria-labelledby="ads-list" className="rounded-2xl border border-slate-200 bg-white">
            <h2 id="ads-list" className="sr-only">Campaigns and ads</h2>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <div role="tablist" aria-label="Show" className="flex gap-4">
                {(["campaigns", "ads"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setParam({ view: v === "campaigns" ? null : v })}
                    className={`border-b-2 pb-1 text-[13px] font-medium ${view === v ? "border-primary text-slate-900" : "border-transparent text-slate-500"}`}>
                    {v === "campaigns" ? `Campaigns (${data.campaigns.length})` : `Ads (${data.ads.length})`}
                  </button>
                ))}
              </div>
              <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
                <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <span className="sr-only">Search</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={view === "ads" ? "Search ads…" : "Search campaigns…"} autoComplete="off"
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-[12.5px] text-slate-800 placeholder:text-slate-400" />
                </label>
                <select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === "spend" ? null : e.target.value })}
                  className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] text-slate-700">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {(view === "campaigns" ? campaigns.length : ads.length) === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-slate-500">
                {q ? "Nothing matches that search." : "No ad brought anyone in this period yet. New ad clicks and form fills appear here by themselves."}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {view === "campaigns"
                  ? campaigns.map((c) => (
                    <li key={campaignKey(c)}>
                      <Row title={c.campaignName ?? "Campaign not named yet"} meta={`${c.ads} ${c.ads === 1 ? "ad" : "ads"}`}
                        spend={money(c.spend, cur)} leads={c.leads} cpl={money(c.costPerLead, cur)}
                        onOpen={() => setParam({ open: `campaign:${campaignKey(c)}` })} />
                    </li>
                  ))
                  : ads.map((a) => (
                    <li key={a.adId}>
                      <Row title={adTitle(a)} thumb={a.thumbnailUrl} status={a.status}
                        meta={[a.campaignName, a.channels.map((ch) => CHANNEL[ch] ?? ch).join(", ")].filter(Boolean).join(" · ")}
                        spend={money(a.spend, a.currency ?? cur)} leads={a.leads} cpl={money(a.costPerLead, a.currency ?? cur)}
                        warn={Boolean(a.spend && a.leads === 0)}
                        onOpen={() => setParam({ open: `ad:${a.adId}` })} />
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Sheet open={Boolean(openCampaign || openAd)} onOpenChange={(o) => { if (!o) setParam({ open: null }) }}>
        <SheetContent side="right" className="gap-0 overflow-y-auto overscroll-contain p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          {openCampaign && data && (
            <CampaignProfile c={openCampaign} ads={data.ads.filter((a) => campaignKey(a) === campaignKey(openCampaign))} currency={cur}
              onOpenAd={(id) => setParam({ open: `ad:${id}` })} />
          )}
          {openAd && data && (
            <AdProfile a={openAd} currency={openAd.currency ?? cur}
              onOpenCampaign={() => setParam({ open: `campaign:${campaignKey(openAd)}` })} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function sortRows<T extends { spend: number | null; leads: number; won: number; costPerLead: number | null }>(list: T[], sort: Sort): T[] {
  const out = [...list]
  if (sort === "leads") out.sort((a, b) => b.leads - a.leads || (b.spend ?? 0) - (a.spend ?? 0))
  else if (sort === "won") out.sort((a, b) => b.won - a.won || b.leads - a.leads)
  else if (sort === "cpl") out.sort((a, b) => (a.costPerLead ?? Infinity) - (b.costPerLead ?? Infinity))
  else out.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.leads - a.leads)
  return out
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
      <dt className="text-[12px] text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-[22px] font-semibold tabular-nums text-slate-900" title={value}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-[11.5px] text-slate-500" title={sub}>{sub}</dd>}
    </div>
  )
}

function Row({ title, meta, thumb, status, spend, leads, cpl, warn, onOpen }: {
  title: string; meta?: string; thumb?: string | null; status?: string | null
  spend: string; leads: number; cpl: string; warn?: boolean; onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-slate-900" title={title}>{title}</span>
          <StatusDot status={status} />
        </span>
        {meta ? <span className="block truncate text-[11.5px] text-slate-500" title={meta}>{meta}</span> : null}
        {/* Phones: the three numbers under the name */}
        <span className="mt-1 flex gap-3 text-[11.5px] text-slate-600 sm:hidden">
          <span>{spend}</span><span>{n(leads)} leads</span><span className={warn ? "text-rose-700" : ""}>{cpl}/lead</span>
        </span>
      </span>
      <span className="hidden shrink-0 grid-cols-3 gap-6 text-right sm:grid">
        <Num label="Spent" value={spend} />
        <Num label="Leads" value={n(leads)} />
        <Num label="Per lead" value={cpl} tone={warn ? "text-rose-700" : undefined} />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

function Num({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="w-20">
      <span className="block text-[10.5px] text-slate-400">{label}</span>
      <span className={`block text-[13px] font-medium tabular-nums ${tone ?? "text-slate-800"}`}>{value}</span>
    </span>
  )
}

// ── profiles ────────────────────────────────────────────────────────────

type FunnelSource = Pick<CampaignRow, "spend" | "impressions" | "clicks" | "arrivals" | "leads" | "qualified" | "won" | "cpc" | "costPerLead" | "costPerQualified" | "costPerSale">

function Funnel({ r, currency }: { r: FunnelSource; currency: string | null }) {
  const steps = [
    { label: "Impressions", value: r.impressions, cost: null as number | null, from: null as number | null },
    { label: "Clicks", value: r.clicks, cost: r.cpc, from: r.impressions },
    { label: "Came in", value: r.arrivals, cost: null, from: r.clicks },
    { label: "Leads", value: r.leads, cost: r.costPerLead, from: r.arrivals || r.clicks },
    { label: "Qualified", value: r.qualified, cost: r.costPerQualified, from: r.leads },
    { label: "Won", value: r.won, cost: r.costPerSale, from: r.qualified || r.leads },
  ]
  // Log scale: impressions are thousands of times larger than sales, and
  // every step should still be visible.
  const top = Math.log10(Math.max(...steps.map((s) => s.value ?? 0), 1) + 1)
  const width = (v: number | null) => (v ? Math.max(4, (Math.log10(v + 1) / top) * 100) : 0)
  return (
    <ol className="space-y-2.5">
      {steps.map((s) => (
        <li key={s.label} className="text-[12.5px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-slate-600">{s.label}</span>
            <span className="text-right tabular-nums text-slate-800">
              {n(s.value)}
              <span className="ml-1.5 text-[11px] text-slate-400">
                {s.cost != null ? `${money(s.cost, currency, 2)} each` : rate(s.value, s.from) != null ? pct(rate(s.value, s.from)) : ""}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${width(s.value)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function Grid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 xs:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{k}</dt>
          <dd className="truncate text-[14px] font-medium tabular-nums text-slate-900" title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Events({ events }: { events: Record<string, number> }) {
  const list = Object.entries(events).sort((a, b) => b[1] - a[1])
  if (list.length === 0) return <p className="text-[12px] text-slate-500">Meta reported no events for this period.</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map(([k, v]) => (
        <li key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] text-slate-700"><span className="font-semibold tabular-nums">{n(v)}</span> {k}</li>
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-5 py-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function CampaignProfile({ c, ads, currency, onOpenAd }: { c: CampaignRow; ads: AdRow[]; currency: string | null; onOpenAd: (id: string) => void }) {
  return (
    <>
      <SheetHeader className="px-5 pb-4 pt-5 pr-12">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Campaign</p>
        <SheetTitle className="text-[17px] font-semibold text-slate-900 [overflow-wrap:anywhere]">{c.campaignName ?? "Campaign not named yet"}</SheetTitle>
        <SheetDescription className="text-[12px] text-slate-500">{c.ads} {c.ads === 1 ? "ad" : "ads"}</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-2 gap-3 px-5 pb-4">
        <Kpi label="Spent" value={money(c.spend, currency)} />
        <Kpi label="Return on spend" value={roas(c.roas)} sub={`Revenue ${revenue(c.revenue)}`} />
      </div>
      <Section title="From impression to sale"><Funnel r={c} currency={currency} /></Section>
      <Section title="Delivery">
        <Grid items={[["Impressions", n(c.impressions)], ["Clicks", n(c.clicks)], ["CTR", pct(c.ctr)], ["CPC", money(c.cpc, currency, 2)], ["CPM", money(c.cpm, currency, 2)], ["Came in from ads", n(c.arrivals)]]} />
      </Section>
      <Section title="Events recorded by Meta"><Events events={c.events ?? {}} /></Section>
      <Section title={`Ads in this campaign (${ads.length})`}>
        {ads.length === 0 ? <p className="text-[12px] text-slate-500">No ad of this campaign brought anyone in this period.</p> : (
          <ul className="-mx-2 divide-y divide-slate-100">
            {ads.map((a) => (
              <li key={a.adId}>
                <button type="button" onClick={() => onOpenAd(a.adId)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate text-[13px] font-medium text-slate-900" title={adTitle(a)}>{adTitle(a)}</span><StatusDot status={a.status} /></span>
                    <span className="block text-[11.5px] text-slate-500">{money(a.spend, a.currency ?? currency)} · {n(a.leads)} leads · {money(a.costPerLead, a.currency ?? currency)}/lead</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function AdProfile({ a, currency, onOpenCampaign }: { a: AdRow; currency: string | null; onOpenCampaign: () => void }) {
  return (
    <>
      <SheetHeader className="px-5 pb-4 pt-5 pr-12">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ad</p>
        <div className="flex min-w-0 items-start gap-3">
          {a.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.thumbnailUrl} alt="" width={56} height={56} loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0">
            <SheetTitle className="text-[17px] font-semibold text-slate-900 [overflow-wrap:anywhere]">{adTitle(a)}</SheetTitle>
            <SheetDescription className="mt-0.5 text-[12px] text-slate-500 [overflow-wrap:anywhere]">
              {[a.adsetName, a.channels.map((ch) => CHANNEL[ch] ?? ch).join(", ")].filter(Boolean).join(" · ") || "—"}
            </SheetDescription>
            <div className="mt-1"><StatusDot status={a.status} /></div>
          </div>
        </div>
        {a.campaignName && (
          <button type="button" onClick={onOpenCampaign} className="mt-2 inline-flex max-w-full items-center gap-1 self-start rounded-lg text-[12px] font-medium text-primary hover:underline">
            <span className="truncate">Campaign: {a.campaignName}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
        )}
      </SheetHeader>
      <div className="grid grid-cols-2 gap-3 px-5 pb-4">
        <Kpi label="Spent" value={money(a.spend, currency)} />
        <Kpi label="Return on spend" value={roas(a.roas)} sub={`Revenue ${revenue(a.revenue)}`} />
      </div>
      <Section title="From impression to sale"><Funnel r={a} currency={currency} /></Section>
      <Section title="Delivery">
        <Grid items={[["Impressions", n(a.impressions)], ["Reach", n(a.reach)], ["Clicks", n(a.clicks)], ["CTR", pct(a.ctr)], ["CPC", money(a.cpc, currency, 2)], ["CPM", money(a.cpm, currency, 2)]]} />
      </Section>
      <Section title="Events recorded by Meta"><Events events={a.events ?? {}} /></Section>
      <Section title="Outcome">
        <Grid items={[["Leads", n(a.leads)], ["Qualified", n(a.qualified)], ["Won", n(a.won)], ["Lost", n(a.lost)], ["Cost per lead", money(a.costPerLead, currency)], ["Cost per sale", money(a.costPerSale, currency)]]} />
      </Section>
    </>
  )
}
