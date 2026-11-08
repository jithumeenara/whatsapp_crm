import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"

import { formatChange } from "@/lib/format/delta"
import { cn } from "@/lib/utils"

interface DeltaProps {
  curr: number | null | undefined
  prev: number | null | undefined
  /** Which direction is good news: "down" for things like reply time. */
  goodWhen?: "up" | "down"
  /** Comparison period, for example "vs 1-8 Oct". */
  label?: string
  /** Below this, either figure counts as small and the pill is shown neutral. */
  smallBelow?: number
  className?: string
}

function Delta({ curr, prev, goodWhen = "up", label, smallBelow, className }: DeltaProps) {
  const c = formatChange(curr, prev, { smallBelow })

  if (c.pct === null || c.direction === null) {
    return (
      <span data-slot="delta" className={cn("text-[11.5px] text-slate-500", className)}>
        {label ? label : "No comparison yet"}
      </span>
    )
  }

  const neutral = c.direction === "flat" || c.small
  const good = c.direction === goodWhen
  const Icon = c.direction === "up" ? ArrowUpRight : c.direction === "down" ? ArrowDownRight : ArrowRight
  const tone = neutral
    ? "bg-slate-100 text-slate-600"
    : good
      ? "bg-emerald-50 text-emerald-700"
      : "bg-rose-50 text-rose-700"
  const word = c.direction === "flat" ? "" : c.direction === "up" ? "Up " : "Down "

  return (
    <span data-slot="delta" className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone)}>
        <Icon aria-hidden="true" className="size-3" />
        <span className="sr-only">{word}</span>
        {c.direction === "flat" ? c.text : c.text.replace(/^[+-]/, "")}
      </span>
      {label ? <span className="text-[11.5px] text-slate-500">{label}</span> : null}
    </span>
  )
}

export { Delta }
