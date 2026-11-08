"use client"

import { useEffect, useRef, useState } from "react"
import { Megaphone, Wallet } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { formatCurrency } from "@/lib/currency"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import type { MetaAdsPeriod } from "@/lib/meta-ads/ad-leads"
import { Definition, MaybeLink, Section } from "./shared"
import { periodLabel, sourceName, type PeriodKind } from "./view-model"

type AdsState = { period: PeriodKind; value: MetaAdsPeriod | null; error: string | null }

/**
 * Real ad spend from Meta for the period on screen, beside the leads that
 * came from ads (lead forms + click-to-WhatsApp). Loaded on its own after
 * the dashboard, so a slow answer from Meta never holds the page up.
 */
function MetaAdsStrip({ period, allowed }: { period: PeriodKind; allowed: string[] | null | undefined }) {
  const [state, setState] = useState<AdsState | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    apiFetch(`/api/dashboard/ads?period=${period}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<MetaAdsPeriod>)
      .then((value) => { if (mine === seq.current) setState({ period, value, error: null }) })
      .catch((err) => {
        console.error("[dashboard] ads load failed", err)
        if (mine === seq.current) setState({ period, value: null, error: errorText(err, "Could not load ad spend.") })
      })
  }, [period])

  const loading = !state || state.period !== period
  const box = "rounded-xl border border-slate-200/80 bg-slate-50/60 p-3"

  if (loading) {
    return (
      <div className={box} role="status" aria-label="Loading ad spend">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      </div>
    )
  }
  if (state.error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700" role="alert">{state.error}</p>
  const v = state.value
  if (!v || !v.connected) {
    return (
      <div className={`${box} flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-600`}>
        <p className="min-w-0">Connect Meta Ads to see real ad spend and the leads your ads bring.</p>
        <MaybeLink href="/ads" allowed={allowed} className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 shadow-sm hover:bg-slate-50">
          Open Ads
        </MaybeLink>
      </div>
    )
  }

  const cur = v.currency
  const moneyOrDash = (n: number | null) => (n === null ? "—" : cur ? formatCurrency(n, cur) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
  const stats: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Ad spend", value: moneyOrDash(v.spend), sub: periodLabel(period) },
    { label: "Leads from ads", value: v.leads.total.toLocaleString(), sub: `${v.leads.form} form · ${v.leads.clickToWhatsApp} click-to-WhatsApp` },
    { label: "Cost per lead", value: moneyOrDash(v.costPerLead), sub: v.costPerLead === null && v.spend !== null ? "No ad leads yet" : undefined },
    { label: "Clicks", value: v.clicks === null ? "—" : v.clicks.toLocaleString(), sub: v.impressions === null ? undefined : `${v.impressions.toLocaleString()} impressions` },
  ]
  return (
    <div className={box}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"><Megaphone className="size-3.5" aria-hidden /></span>
        <p className="text-[12.5px] font-semibold text-slate-800">Meta ads</p>
        <MaybeLink href="/ads" allowed={allowed} className="ml-auto text-[12px] font-semibold text-slate-600 hover:text-indigo-700">Open Ads →</MaybeLink>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 rounded-lg bg-white p-2.5 ring-1 ring-slate-200/70">
            <dt className="text-[11.5px] text-slate-500">{s.label}</dt>
            <dd className="mt-0.5 break-words text-[18px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">{s.value}</dd>
            {s.sub ? <dd className="mt-0.5 break-words text-[11px] text-slate-500">{s.sub}</dd> : null}
          </div>
        ))}
      </dl>
      {v.needsAdAccount ? (
        <p className="mt-2 text-[12px] text-amber-900">Add your ad account in Ads settings to read spend from Meta. Leads from ads are counted already.</p>
      ) : null}
      {v.error ? <p className="mt-2 text-[12px] text-rose-700" role="alert">{v.error}</p> : null}
    </div>
  )
}

function money(n: number | null, currency: string | null): string {
  if (n === null || !currency) return "—"
  return formatCurrency(n, currency)
}

function monthName(month: string, zone: string | undefined): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  try {
    // Noon UTC on the 15th is the same month in every zone.
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: zone }).format(Date.UTC(y, m - 1, 15, 12))
  } catch {
    return month
  }
}

/**
 * Leads and ad spend, for owners and admins. Spend is typed in per month in
 * Settings → Reports; leads and wins are the month's own Reports counts.
 */
export function SpendSection({ data, allowed, onShowMonth }: {
  data: OwnerDashboard
  allowed: string[] | null | undefined
  onShowMonth: () => void
}) {
  if (!data.money) return null
  const tip = (
    <Definition label="How ad spend is counted" allowed={allowed}>
      Meta ads: the spend Meta reports for these days, beside leads from your ad forms and from click-to-WhatsApp ads on the same days.
      By source: the spend you type in Settings → Reports for the month, beside that month’s leads from the same source.
      Cost per lead is spend divided by leads.
    </Definition>
  )

  return (
    <Section title="Ads: spend and leads" tip={tip}>
      <MetaAdsStrip period={data.period.kind} allowed={allowed} />
      <div className="mt-4">
        <ManualSpend data={data} allowed={allowed} onShowMonth={onShowMonth} />
      </div>
    </Section>
  )
}

/** Spend typed in per source in Settings → Reports, beside each source's leads that month. */
function ManualSpend({ data, allowed, onShowMonth }: {
  data: OwnerDashboard
  allowed: string[] | null | undefined
  onShowMonth: () => void
}) {
  if (!data.spend) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-[12.5px] text-slate-600">
        <p className="min-w-0">Spend by source that you type in yourself is kept per month, so it shows on This month.</p>
        <button
          type="button"
          onClick={onShowMonth}
          className="h-8 shrink-0 rounded-full border border-slate-200 bg-white px-3.5 text-[12.5px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Show this month
        </button>
      </div>
    )
  }

  const { rows, entered, month } = data.spend
  const heading = (
    <h3 className="mb-2 text-[13px] font-semibold text-slate-800">
      By source · {monthName(month, data.period.timeZone)}
      {entered ? <span className="ml-2 text-[11.5px] font-normal text-slate-500">Spend you entered, leads from Reports</span> : null}
    </h3>
  )
  const settingsLink = (
    <MaybeLink href="/settings?tab=reports" allowed={allowed} className="font-semibold text-indigo-700 underline underline-offset-2">
      Settings → Reports
    </MaybeLink>
  )

  if (rows.length === 0) {
    return (
      <>
        {heading}
        <EmptyState icon={<Wallet />} title="No leads or spend this month" description="Type each source’s ad spend in Settings → Reports to see what a lead costs." />
      </>
    )
  }

  const spendRows = rows.filter((r) => r.spend !== null)
  return (
    <>
      {heading}
      {!entered ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          No ad spend entered for this month yet. Add it in {settingsLink} to see the cost of each lead.
        </p>
      ) : null}

      {/* Phones: one card per source. From sm: a table. */}
      <ul className="list-none space-y-2 p-0 sm:hidden">
        {rows.map((r, i) => (
          <li key={`${r.source}-${r.currency ?? "none"}-${i}`} className="rounded-lg border border-slate-200 p-3 text-[12.5px]">
            <p className="break-words text-[13px] font-semibold text-slate-900">{sourceName(r.source)}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
              <div><dt className="inline">Spend </dt><dd className="inline font-semibold tabular-nums text-slate-900">{money(r.spend, r.currency)}</dd></div>
              <div><dt className="inline">Leads </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.leads}</dd></div>
              <div><dt className="inline">Per lead </dt><dd className="inline font-semibold tabular-nums text-slate-900">{money(r.costPerLead, r.currency)}</dd></div>
              <div><dt className="inline">Won </dt><dd className="inline font-semibold tabular-nums text-slate-900">{r.won}</dd></div>
              <div className="col-span-2"><dt className="inline">Per win </dt><dd className="inline font-semibold tabular-nums text-slate-900">{money(r.costPerWin, r.currency)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[34rem] text-[12.5px]">
          <caption className="sr-only">Ad spend, leads and cost per lead by source</caption>
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pr-3">Source</th>
              <th scope="col" className="py-2 pr-3 text-right">Spend</th>
              <th scope="col" className="py-2 pr-3 text-right">Leads</th>
              <th scope="col" className="py-2 pr-3 text-right">Cost per lead</th>
              <th scope="col" className="py-2 pr-3 text-right">Won</th>
              <th scope="col" className="py-2 text-right">Cost per win</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.source}-${r.currency ?? "none"}-${i}`} className="border-b border-slate-50 last:border-0">
                <th scope="row" className="max-w-[14rem] break-words py-2.5 pr-3 text-left font-medium text-slate-800">{sourceName(r.source)}</th>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">{money(r.spend, r.currency)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">{r.leads.toLocaleString()}</td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-slate-900">{money(r.costPerLead, r.currency)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">{r.won.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-900">{money(r.costPerWin, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entered && spendRows.length < rows.length ? (
        <p className="mt-3 text-[11.5px] text-slate-500">
          Sources showing “—” have no spend entered this month. A spend name is matched to a source whatever its case or spacing.
        </p>
      ) : null}
    </>
  )
}
