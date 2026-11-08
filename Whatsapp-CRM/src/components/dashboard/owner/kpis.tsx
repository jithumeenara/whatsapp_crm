"use client"

import type { ComponentType, ReactNode } from "react"
import { Target, Timer, Trophy, UsersRound, Wallet } from "lucide-react"
import { Delta } from "@/components/ui/delta"
import { formatCurrency } from "@/lib/currency"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { CARD, Definition, MaybeLink } from "./shared"
import { comparisonLabel, dealsWithoutAmount, formatMinutes, winRate } from "./view-model"

function KpiTile({
  label, tip, value, children, href, allowed, faded, icon: Icon,
}: {
  label: string
  tip: ReactNode
  value: ReactNode
  children?: ReactNode
  href: string
  allowed: string[] | null | undefined
  faded?: boolean
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}) {
  return (
    <li className={cn(CARD, "flex min-w-0 flex-col p-4 sm:p-5")}>
      <div className="flex items-start justify-between gap-1">
        <Icon aria-hidden className="size-7 text-slate-800" strokeWidth={1.5} />
        {tip}
      </div>
      <p className={cn("mt-4 break-words text-[30px] font-semibold leading-none tracking-tight tabular-nums text-slate-900", faded && "opacity-60")}>{value}</p>
      <MaybeLink href={href} allowed={allowed} className="mt-2 min-w-0 break-words text-[13px] text-slate-500 hover:text-slate-900 hover:underline hover:underline-offset-2">
        {label}
      </MaybeLink>
      <div className="mt-2 min-w-0 break-words text-[11.5px] text-slate-600">{children}</div>
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
    <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5" aria-label="Headline numbers">
      <KpiTile
        icon={UsersRound} label="New leads" href="/reports" allowed={allowed} value={kpis.cohort.total.toLocaleString()}
        tip={<Definition label="What are new leads" allowed={allowed}>Leads that came in during this period, not counting hidden ones or ones the assistant only suggested.</Definition>}
      >
        <Delta curr={kpis.cohort.total} prev={kpis.previousCohort.total} smallBelow={smallNumber} label={vs} />
      </KpiTile>

      <KpiTile
        icon={Trophy} label="Won" href="/leads?tab=closed" allowed={allowed} value={kpis.wonInPeriod.toLocaleString()}
        tip={<Definition label="What counts as won" allowed={allowed}>Leads closed as won during this period, credited to the person who closed them.</Definition>}
      >
        {revenue ? <p className="mb-0.5 font-semibold text-slate-800">{revenue} revenue</p> : null}
        <Delta curr={kpis.wonInPeriod} prev={kpis.previousWonInPeriod} smallBelow={smallNumber} label={vs} />
      </KpiTile>

      {showMoney ? (
        <KpiTile
          icon={Wallet} label="Open pipeline" href="/pipelines" allowed={allowed}
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
        icon={Target} label="Win rate" href="/reports" allowed={allowed} faded={rate.faded}
        value={rate.pct === null ? "—" : `${rate.pct}%`}
        tip={<Definition label="How win rate is worked out" allowed={allowed}>Leads won divided by all leads that came in during this period. Closed-lost and still-open leads both count against it.</Definition>}
      >
        {kpis.cohort.total === 0
          ? "No leads in this period"
          : `${kpis.cohort.won} of ${kpis.cohort.total} leads${rate.faded ? ". Small number, read with care" : ""}`}
      </KpiTile>

      <KpiTile
        icon={Timer} label="First reply (median)" href="/reports" allowed={allowed} value={formatMinutes(kpis.medianFirstReplyMinutes)}
        tip={<Definition label="What is first reply time" allowed={allowed}>The middle time from a lead arriving to the first reply by a person. Replies by the assistant do not count.</Definition>}
      >
        <Delta curr={kpis.medianFirstReplyMinutes} prev={kpis.previousMedianFirstReplyMinutes} goodWhen="down" smallBelow={0} label={vs} />
      </KpiTile>
    </ul>
  )
}
