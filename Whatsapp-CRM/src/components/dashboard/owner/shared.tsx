"use client"

import Link from "next/link"
import { createContext, useContext, type ReactNode } from "react"
import type { AccountRole } from "@/lib/auth/roles"
import { InfoTip } from "@/components/ui/info-tip"
import { cn } from "@/lib/utils"
import { linkOrText } from "./view-model"

/** Who is looking, so a link is only drawn to a page they may open. */
export const RoleContext = createContext<AccountRole | null>(null)

export const CARD = "rounded-xl border border-slate-200 bg-white shadow-card"

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
    <section className={cn(CARD, "min-w-0 p-4", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 text-[14px] font-semibold text-slate-900">
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
