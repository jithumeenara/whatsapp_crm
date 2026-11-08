"use client"

import type { ReactNode } from "react"
import { Delta } from "@/components/ui/delta"
import { formatCurrency } from "@/lib/currency"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { Definition, MaybeLink } from "./shared"
import { comparisonLabel, dealsWithoutAmount, formatMinutes, winRate } from "./view-model"

function KpiTile({
  label, tip, value, children, href, allowed, faded,
}: {
  label: string
  tip: ReactNode
  value: ReactNode
  children?: ReactNode
  href: string
  allowed: string[] | null | undefined
  faded?: boolean
}) {
  return (
    <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <div className="flex items-center justify-between gap-1">
        <MaybeLink href={href} allowed={allowed} className="min-w-0 break-words text-[12px] font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
          {label}
        </MaybeLink>
        {tip}
      </div>
      <p className={cn("mt-1 break-words text-[24px] font-bold leading-tight tabular-nums text-slate-900", faded && "opacity-60")}>{value}</p>
      <div className="mt-1 min-w-0 break-words text-[11.5px] text-slate-600">{children}</div>
    </li>
  )
}

/** Big figures in short form (₹18.6L, $1.9M) so they never break across lines in a small tile. */
function moneyShort(m: Array<{ currency: string; amount: number }> | null): string {
  if (!m || m.length === 0) return ""
  return m.map((x) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: x.currency, notation: "compact", maximumFractionDigits: 1 }).format(x.amount)
    } catch {
      return formatCurrency(x.amount, x.currency)
    }
  }).join(" · ")
}

function moneyLines(m: Array<{ currency: string; amount: number }> | null): string {
  if (!m || m.length === 0) return ""
  return m.map((x) => formatCurrency(x.amount, x.currency)).join(" · ")
}

export function KpiTiles({ data, allowed }: { data: OwnerDashboard; allowed: string[] | null | undefined }) {
  const { kpis, period, smallNumber } = data
  const vs = comparisonLabel(period.kind, period.partial)
  const rate = winRate(kpis.cohort, smallNumber)
  const noAmount = dealsWithoutAmount(kpis.pipeline)
  const openDeals = (kpis.pipeline ?? []).reduce((s, m) => s + m.deals, 0)
  const showMoney = data.money
  const revenue = showMoney ? moneyLines(kpis.revenue) : ""

  return (
    <ul className="grid list-none grid-cols-2 gap-2.5 p-0 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5" aria-label="Headline numbers">
      <KpiTile
        label="New leads" href="/reports" allowed={allowed} value={kpis.cohort.total.toLocaleString()}
        tip={<Definition label="What are new leads" allowed={allowed}>Leads that came in during this period, not counting hidden ones or ones the assistant only suggested.</Definition>}
      >
        <Delta curr={kpis.cohort.total} prev={kpis.previousCohort.total} smallBelow={smallNumber} label={vs} />
      </KpiTile>

      <KpiTile
        label="Won" href="/leads?tab=closed" allowed={allowed} value={kpis.wonInPeriod.toLocaleString()}
        tip={<Definition label="What counts as won" allowed={allowed}>Leads closed as won during this period, credited to the person who closed them.</Definition>}
      >
        {revenue ? <p className="mb-0.5 font-semibold text-slate-800">{revenue} revenue</p> : null}
        <Delta curr={kpis.wonInPeriod} prev={kpis.previousWonInPeriod} smallBelow={smallNumber} label={vs} />
      </KpiTile>

      {showMoney ? (
        <KpiTile
          label="Open pipeline" href="/pipelines" allowed={allowed}
          value={kpis.pipeline && kpis.pipeline.length > 0 ? moneyShort(kpis.pipeline) : "—"}
          tip={<Definition label="What is open pipeline" allowed={allowed}>The value of deals that are still open, as entered on each deal.</Definition>}
        >
          {kpis.pipeline && kpis.pipeline.length > 0 ? (
            <>
              {openDeals} open {openDeals === 1 ? "deal" : "deals"}
              {noAmount > 0 ? `, ${noAmount} ${noAmount === 1 ? "deal" : "deals"} without an amount` : ""}
            </>
          ) : "No open deals"}
        </KpiTile>
      ) : null}

      <KpiTile
        label="Win rate" href="/reports" allowed={allowed} faded={rate.faded}
        value={rate.pct === null ? "—" : `${rate.pct}%`}
        tip={<Definition label="How win rate is worked out" allowed={allowed}>Leads won divided by all leads that came in during this period. Closed-lost and still-open leads both count against it.</Definition>}
      >
        {kpis.cohort.total === 0
          ? "No leads in this period"
          : `${kpis.cohort.won} of ${kpis.cohort.total} leads${rate.faded ? ". Small number, read with care" : ""}`}
      </KpiTile>

      <KpiTile
        label="First reply (median)" href="/reports" allowed={allowed} value={formatMinutes(kpis.medianFirstReplyMinutes)}
        tip={<Definition label="What is first reply time" allowed={allowed}>The middle time from a lead arriving to the first reply by a person. Replies by the assistant do not count.</Definition>}
      >
        <Delta curr={kpis.medianFirstReplyMinutes} prev={kpis.previousMedianFirstReplyMinutes} goodWhen="down" smallBelow={0} label={vs} />
      </KpiTile>
    </ul>
  )
}
