"use client"

import { useMemo } from "react"
import { SlidersHorizontal, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  filterableFields,
  optionsFor,
  activeFilterCount,
  type FilterMap,
} from "@/lib/data-store/filters"
import type { DataField, DataRecord } from "@/lib/data-store/types"

/**
 * The filter bar for one table.
 *
 * Renders whatever the table happens to have — the decisions about
 * which fields are filterable and what each one should offer all live
 * in `@/lib/data-store/filters`, so this file only has to lay them out.
 * It never names a column, which is what lets the same bar sit above a
 * training schedule, a clinic's appointment book and a shop's price
 * list without any of them configuring anything.
 *
 * Hidden entirely when the table has nothing worth filtering by. A bar
 * offering no filters is worse than no bar.
 */

const ANY = "__any__"

export interface RecordFiltersProps {
  fields: DataField[]
  /** Every record, unfiltered — the option lists are counted off these. */
  records: DataRecord[]
  filters: FilterMap
  onChange: (next: FilterMap) => void
  /** How many rows survive, shown so the effect of a choice is visible
   *  without scrolling down to the table. */
  matchCount: number
  totalCount: number
}

export function RecordFilters(props: RecordFiltersProps) {
  const { fields, records, filters, onChange } = props

  const filterable = useMemo(() => filterableFields(fields), [fields])
  const activeCount = activeFilterCount(filters)

  if (filterable.length === 0) return null

  function set(key: string, value: FilterMap[string] | null) {
    const next = { ...filters }
    if (value === null) delete next[key]
    else next[key] = value
    onChange(next)
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="mb-2.5 flex items-center gap-2">
        <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[12px] font-medium text-slate-600">Filter</span>
        {activeCount > 0 && (
          <>
            <span className="text-[11.5px] text-slate-400">
              {props.matchCount} of {props.totalCount} records
            </span>
            <button
              onClick={() => onChange({})}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filterable.map(({ field, kind }) => {
          const current = filters[field.field_key]

          if (kind === "choice" || kind === "bool") {
            // Both are a single pick from a short list; the only
            // difference is where the list comes from.
            const options =
              kind === "bool"
                ? [
                    { value: "yes", label: "Yes", count: -1 },
                    { value: "no", label: "No", count: -1 },
                  ]
                : optionsFor(field, records, fields, filters)

            const value =
              current?.kind === "choice" || current?.kind === "bool" ? current.value : ANY

            return (
              <label key={field.id} className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-slate-500">{field.label}</span>
                <Select
                  value={value}
                  onValueChange={(v) => {
                    if (!v || v === ANY) return set(field.field_key, null)
                    set(
                      field.field_key,
                      kind === "bool"
                        ? { kind: "bool", value: v === "yes" ? "yes" : "no" }
                        : { kind: "choice", value: v },
                    )
                  }}
                >
                  <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 bg-white text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.count >= 0 ? `${o.label} (${o.count})` : o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )
          }

          // Date and number both narrow between two ends, so they share
          // one control with different input types.
          const range = current?.kind === "range" ? current : { from: "", to: "" }
          const inputType = kind === "date" ? "date" : "number"

          const setEnd = (end: "from" | "to", raw: string) => {
            const next = { ...range, [end]: raw }
            if (!next.from && !next.to) return set(field.field_key, null)
            set(field.field_key, { kind: "range", from: next.from, to: next.to })
          }

          return (
            <div key={field.id} className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-slate-500">
                {field.label}
                <span className="ml-1 text-slate-400">{kind === "date" ? "(from / to)" : "(min / max)"}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  autoComplete="off"
                  type={inputType}
                  value={range.from}
                  onChange={(e) => setEnd("from", e.target.value)}
                  placeholder={kind === "date" ? "" : "Min"}
                  className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <span className="shrink-0 text-[12px] text-slate-400">–</span>
                <input
                  autoComplete="off"
                  type={inputType}
                  value={range.to}
                  onChange={(e) => setEnd("to", e.target.value)}
                  placeholder={kind === "date" ? "" : "Max"}
                  className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
