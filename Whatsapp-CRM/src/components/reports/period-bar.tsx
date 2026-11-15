"use client"

/**
 * Which period a report covers and what it is compared with. Everything
 * lives in the address (period, from, to, compare), so it survives a
 * refresh, a shared link and moving between reports. Defaults:
 * this week, compared with the period before.
 */

import { useId, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { isDay, readQuery, type CompareKey, type PeriodKey, type ReportQuery } from "./report-query"

const MAIN: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
]

const MORE: Array<{ key: PeriodKey; label: string }> = [
  { key: "yesterday", label: "Yesterday" },
  { key: "last_week", label: "Last week" },
  { key: "last_month", label: "Last month" },
  { key: "last_7", label: "Last 7 days" },
  { key: "last_30", label: "Last 30 days" },
  { key: "year", label: "This year" },
]

const COMPARE_LABEL: Record<CompareKey, string> = {
  previous: "vs previous period",
  year: "vs last year",
  none: "No comparison",
}

const segBtn = (on: boolean) =>
  cn(
    "flex h-9 min-w-0 items-center justify-center rounded-lg px-1 text-[12px] font-semibold transition-colors sm:px-3 sm:text-[12.5px]",
    on ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
  )

export function PeriodBar() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const q = readQuery(sp)
  const ids = useId()

  // The date pickers open on "Dates", filled with the dates on screen.
  const [showDates, setDatesOpen] = useState(false)
  const [from, setFrom] = useState(q.from)
  const [to, setTo] = useState(q.to)

  function go(next: Partial<ReportQuery>) {
    const merged = { ...q, ...next }
    // Nothing changed (e.g. a select event replayed during hydration with
    // the value already on screen): leave the address alone.
    if (merged.period === q.period && merged.compare === q.compare && merged.from === q.from && merged.to === q.to && sp?.get("period")) return
    const p = new URLSearchParams(sp?.toString() ?? "")
    p.set("period", merged.period)
    if (merged.period === "custom") {
      p.set("from", merged.from)
      p.set("to", merged.to)
    } else {
      p.delete("from")
      p.delete("to")
    }
    p.set("compare", merged.compare)
    p.delete("list")
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function pick(period: PeriodKey) {
    setDatesOpen(false)
    go({ period, from: "", to: "" })
  }

  const datesValid = isDay(from) && isDay(to) && from <= to
  const datesHint = !from || !to
    ? "Choose both dates."
    : from > to
      ? "The first date must be on or before the second."
      : null

  function applyDates(e: React.FormEvent) {
    e.preventDefault()
    if (!datesValid) return
    go({ period: "custom", from, to })
    setDatesOpen(false)
  }

  const moreActive = MORE.find((m) => m.key === q.period)

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div role="group" aria-label="Period" className="grid grid-cols-[1fr_1.25fr_1.3fr_1fr] gap-1 rounded-xl bg-slate-100 p-1 sm:inline-flex sm:w-auto">
          {MAIN.map((m) => (
            <button key={m.key} type="button" aria-pressed={q.period === m.key} onClick={() => pick(m.key)} className={segBtn(q.period === m.key)}>
              <span className="truncate">{m.label}</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={q.period === "custom"}
            aria-expanded={showDates}
            aria-controls={`${ids}-dates`}
            onClick={() => {
              setFrom(q.from)
              setTo(q.to)
              setDatesOpen((o) => !o)
            }}
            className={segBtn(q.period === "custom" || showDates)}
          >
            <span className="truncate">Dates</span>
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors",
                moreActive ? "border-primary/30 bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {moreActive ? moreActive.label : "More"}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {MORE.map((m) => (
                <DropdownMenuItem key={m.key} onClick={() => pick(m.key)} className="text-[13px]">
                  <span className="flex-1">{m.label}</span>
                  {q.period === m.key && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <label htmlFor={`${ids}-compare`} className="sr-only">Compare with</label>
          <select
            id={`${ids}-compare`}
            name="compare"
            value={q.compare}
            onChange={(e) => go({ compare: e.target.value as CompareKey })}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] font-medium text-slate-700 sm:flex-none"
          >
            {(Object.keys(COMPARE_LABEL) as CompareKey[]).map((k) => (
              <option key={k} value={k}>{COMPARE_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {showDates && (
        <form
          id={`${ids}-dates`}
          onSubmit={applyDates}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3"
        >
          <div className="min-w-0">
            <label htmlFor={`${ids}-from`} className="block text-[11.5px] font-medium text-slate-500">From</label>
            <input
              id={`${ids}-from`}
              name="from"
              type="date"
              autoComplete="off"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] text-slate-700"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${ids}-to`} className="block text-[11.5px] font-medium text-slate-500">To</label>
            <input
              id={`${ids}-to`}
              name="to"
              type="date"
              autoComplete="off"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] text-slate-700"
            />
          </div>
          <button
            type="submit"
            disabled={!datesValid}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Show these dates
          </button>
          {datesHint && <p className="w-full text-[12px] text-slate-500" aria-live="polite">{datesHint}</p>}
        </form>
      )}
    </div>
  )
}
