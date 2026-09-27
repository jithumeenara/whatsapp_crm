"use client"

import { useEffect } from "react"
import { X } from "lucide-react"

/** The Data Store's slide-over: the same shell the Fields panel uses,
 *  so every table setting opens the same way. Escape closes it. */
export function SidePanel({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative z-50 flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/** A labelled group inside a panel. */
export function PanelSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

/** Chips with a remove button — numbers, addresses. */
export function ChipList({ items, onRemove, mono }: { items: string[]; onRemove: (v: string) => void; mono?: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <span
          key={v}
          className={`inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1.5 text-[12px] text-slate-700 ${mono ? "font-mono" : ""}`}
        >
          {v}
          <button
            type="button"
            onClick={() => onRemove(v)}
            className="text-slate-400 transition-colors hover:text-rose-500"
            aria-label={`Remove ${v}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
