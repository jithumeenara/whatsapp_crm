"use client"

import { Info } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface InfoTipProps {
  /** Required: names the button for screen readers, for example "What is first reply time". */
  label: string
  /** The definition shown in the popover. */
  children: React.ReactNode
  className?: string
}

/** A small (i) button; click, tap or Enter opens the definition, Escape closes it. */
function InfoTip({ label, children, className }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700",
          className
        )}
      >
        <Info aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 max-w-[calc(100vw-2rem)] text-[12px] leading-snug">
        {children}
      </PopoverContent>
    </Popover>
  )
}

export { InfoTip }
