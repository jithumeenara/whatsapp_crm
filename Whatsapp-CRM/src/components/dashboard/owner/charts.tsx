"use client"

import { BarChart3, Filter } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { Definition, MaybeLink, Section } from "./shared"
import { biggestDropSentence, topNWithOther, winRate } from "./view-model"

const RAMP = ["bg-ramp-1", "bg-ramp-2", "bg-ramp-3", "bg-ramp-4", "bg-ramp-5"]
const CHART = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7", "bg-chart-8"]

export function FunnelSection({ data, allowed, canSetStages }: { data: OwnerDashboard; allowed: string[] | null | undefined; canSetStages: boolean }) {
  const rows = data.funnel.filter((r) => r.outcome !== "lost")
  const first = rows[0]?.count ?? 0
  const sentence = biggestDropSentence(data.funnel)
  return (
    <Section
      title="Where leads drop off"
      hint="Leads that came in this period, by the furthest stage they reached"
      tip={<Definition label="How the funnel is counted" allowed={allowed}>A lead counts at every stage up to the furthest one it reached, even if a step was skipped.</Definition>}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Filter />}
          title="No stages set yet"
          description="Set the steps your leads go through to see where they drop off."
          action={canSetStages ? (
            <MaybeLink href="/settings?tab=reports" allowed={allowed} className="text-[12.5px] font-semibold text-indigo-700 underline underline-offset-2">
              Set stages in Settings, Reports
            </MaybeLink>
          ) : undefined}
        />
      ) : (
        <>
          <ul className="list-none space-y-2 p-0">
            {rows.map((r, i) => {
              const pct = first > 0 ? Math.round((r.count / first) * 100) : 0
              const slot = rows.length === 1 ? 2 : Math.round((i * 4) / (rows.length - 1))
              return (
                <li key={r.key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px] sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]">
                  <span className="min-w-0 break-words text-slate-700">{r.label}</span>
                  <span className="h-4 overflow-hidden rounded bg-slate-100" aria-hidden="true">
                    <span className={cn("block h-full rounded", RAMP[slot])} style={{ width: `${Math.max(pct, r.count > 0 ? 2 : 0)}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-slate-900">
                    <span className="font-semibold">{r.count.toLocaleString()}</span>
                    <span className="ml-1 text-[11px] text-slate-500">{pct}%</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {sentence ? <p className="mt-3 break-words rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700">{sentence}</p> : null}
        </>
      )}
    </Section>
  )
}

export function SourceSection({ data, allowed }: { data: OwnerDashboard; allowed: string[] | null | undefined }) {
  const rows = topNWithOther(data.bySource.filter((s) => s.total > 0), 6)
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  return (
    <Section
      title="Leads by source"
      hint="Won rate beside each"
      tip={<Definition label="How sources are counted" allowed={allowed}>Leads that came in this period, grouped by where they came from. The percentage is how many of them were won.</Definition>}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No leads in this period" description="Leads will be grouped by where they came from." />
      ) : (
        <ul className="list-none space-y-2 p-0">
          {rows.map((r, i) => {
            const isOther = r.folded === true
            const wr = winRate(r, data.smallNumber)
            return (
              <li key={`${r.source}-${i}`} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px] sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]">
                <span className="min-w-0 break-words text-slate-700">{r.folded ? "All other sources" : r.source || "Unknown"}</span>
                <span className="h-4 overflow-hidden rounded bg-slate-100" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded", isOther ? "bg-slate-400" : CHART[i])}
                    style={{ width: `${max > 0 ? Math.max((r.total / max) * 100, 2) : 0}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  <span className="font-semibold text-slate-900">{r.total.toLocaleString()}</span>
                  <span className={cn("ml-1 text-[11px] text-slate-600", wr.faded && "opacity-60")}>
                    {wr.pct === null ? "no wins" : `${Math.round(wr.pct)}% won`}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
