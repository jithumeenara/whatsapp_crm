"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { createContext, useContext, type ReactNode } from "react"
import type { AccountRole } from "@/lib/auth/roles"
import { InfoTip } from "@/components/ui/info-tip"
import { cn } from "@/lib/utils"
import { linkOrText } from "./view-model"

/** Who is looking, so a link is only drawn to a page they may open. */
export const RoleContext = createContext<AccountRole | null>(null)

/** Soft glass card: large radius, faint border, a wide low shadow. */
export const CARD = "rounded-3xl border border-white/80 bg-white/85 shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/50 backdrop-blur-xl"

/** The round ↗ in a card's corner: says the card opens something. Decorative. */
export function ArrowChip({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-700 shadow-[0_2px_10px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60",
        "transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5",
        className,
      )}
    >
      <ArrowUpRight className="size-4" />
    </span>
  )
}

/** A page the person may not open is plain text, not a link. */
export function MaybeLink({
  href, allowed, className, children, ariaLabel,
}: {
  href: string
  allowed: string[] | null | undefined
  className?: string
  children: ReactNode
  ariaLabel?: string
}) {
  const role = useContext(RoleContext)
  const target = linkOrText(href, role, allowed)
  if (!target) return <span className={className}>{children}</span>
  return (
    <Link href={target} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  )
}

export function Section({
  title, hint, children, className, tip,
}: {
  title: string
  hint?: string
  tip?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(CARD, "min-w-0 p-4 sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 text-[17px] font-semibold tracking-tight text-slate-900">
          {title}
          {tip}
        </h2>
        {hint ? <p className="min-w-0 break-words text-[11.5px] text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Plain-words definition with a way to the page that explains it. */
export function Definition({ label, allowed, children }: { label: string; allowed: string[] | null | undefined; children: ReactNode }) {
  return (
    <InfoTip label={label}>
      <p>{children}</p>
      <p className="mt-1.5">
        <MaybeLink href="/reports" allowed={allowed} className="font-semibold text-indigo-700 underline underline-offset-2">
          How Reports counts this
        </MaybeLink>
      </p>
    </InfoTip>
  )
}
