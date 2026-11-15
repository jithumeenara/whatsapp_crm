"use client"

/**
 * The Compare tab's pickers: what to compare (periods, team members,
 * sources, categories, numbers — only what this report offers) and which
 * two to four items. Everything lives in the address (cmp, items) so a
 * comparison can be shared as a link; the server keeps only items that
 * belong to the business.
 */

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Check } from "lucide-react"
import type { CompareSpec } from "@/lib/reports/doc/types"
import { cn } from "@/lib/utils"
import { useReportsMenu } from "./reports-nav"

const SHOW_FIRST = 12

export function CompareControls({ spec }: { spec: CompareSpec | undefined }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { targetPath } = useReportsMenu()
  const [showAll, setShowAll] = useState(false)

  if (!spec || !Array.isArray(spec.options)) return null
  const dims = Array.isArray(spec.dims) ? spec.dims : []
  const selected = Array.isArray(spec.selected) ? spec.selected : []
  const max = spec.max > 0 ? spec.max : 4
  const options = spec.options
  // Selected ones always stay visible, even past the first dozen.
  const visible = showAll ? options : options.filter((o, i) => i < SHOW_FIRST || selected.includes(o.key))

  function go(next: { cmp?: string; items?: string[] | null }) {
    const p = new URLSearchParams(sp?.toString() ?? "")
    p.set("tab", "compare")
    if (next.cmp !== undefined) p.set("cmp", next.cmp)
    if (next.items === null) p.delete("items")
    else if (next.items) p.set("items", next.items.join(","))
    p.delete("list")
    router.replace(`${targetPath(pathname)}?${p.toString()}`, { scroll: false })
  }

  function toggle(key: string) {
    if (selected.includes(key)) {
      if (selected.length === 1) return
      go({ items: selected.filter((k) => k !== key) })
    } else if (selected.length < max) {
      go({ items: [...selected, key] })
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
      {dims.length > 1 && (
        <div className="space-y-1.5">
          <p id="compare-what" className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Compare</p>
          <div role="group" aria-labelledby="compare-what" className="flex flex-wrap gap-1.5">
            {dims.map((d) => (
              <button
                key={d.key}
                type="button"
                aria-pressed={spec.dim === d.key}
                onClick={() => { if (spec.dim !== d.key) { setShowAll(false); go({ cmp: d.key, items: null }) } }}
                className={cn(
                  "h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors",
                  spec.dim === d.key ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p id="compare-items" className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">
          Pick two to {max} <span className="font-normal normal-case tracking-normal text-slate-400">({selected.length} chosen)</span>
        </p>
        {options.length === 0 ? (
          <p className="text-[12.5px] text-slate-500">Nothing to compare in this period yet.</p>
        ) : (
          <div role="group" aria-labelledby="compare-items" className="flex flex-wrap gap-1.5">
            {visible.map((o) => {
              const on = selected.includes(o.key)
              const full = !on && selected.length >= max
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  title={full ? `Up to ${max} at a time` : undefined}
                  onClick={() => toggle(o.key)}
                  className={cn(
                    "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-primary/40 bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })}
            {options.length > visible.length && (
              <button type="button" onClick={() => setShowAll(true)} className="h-9 rounded-full px-3 text-[12.5px] font-semibold text-primary hover:underline">
                Show all {options.length}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
