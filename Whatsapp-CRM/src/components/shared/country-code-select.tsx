"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Search } from "lucide-react"
import { COUNTRY_CODES } from "@/lib/country-codes"

interface Props {
  value: string // ISO code, e.g. "IN"
  onChange: (iso: string) => void
  className?: string
}

/**
 * Country picker matching a supplied reference exactly: a wide, fully
 * rounded ("pill") trigger showing the selected country's full name +
 * dial code as one line, opening a searchable list where each row is
 * flag + "Name (+code)" on one line with a plain highlight for the
 * selected/hovered row (no radio indicator, unlike this component's
 * previous version). Because the trigger now needs room for a full
 * country name, both call sites (signup, Profile edit mode) stack this
 * above the phone digits field instead of placing them side by side.
 */
export function CountryCodeSelect({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const selected = COUNTRY_CODES.find((c) => c.iso === value) ?? COUNTRY_CODES[0]

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    if (open) document.addEventListener("mousedown", onOutsideClick)
    return () => document.removeEventListener("mousedown", onOutsideClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => searchRef.current?.focus(), 0)
    // Scroll the current selection into view instead of always opening at
    // the top of a 240-country list, matching the reference screenshot
    // (which opens already centered on "India").
    selectedRef.current?.scrollIntoView({ block: "center" })
    return () => clearTimeout(t)
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? COUNTRY_CODES.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.dial.includes(q) ||
          c.iso.toLowerCase().includes(q)
      )
    : COUNTRY_CODES

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-2 rounded-full border border-slate-200 bg-white pl-4 pr-3.5 text-[13.5px] text-slate-900 outline-none transition-all hover:border-slate-300 focus:border-[#5B6CF9] focus:ring-2 focus:ring-[#5B6CF9]/15"
      >
        <span className="text-[16px] leading-none">{selected.flag}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          {selected.name} <span className="tabular-nums text-slate-500">({selected.dial})</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-full min-w-[280px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
        >
          <div className="relative p-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] text-slate-900 outline-none transition-all focus:border-[#5B6CF9] focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/15"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto scroll-styled pb-2">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No matching country</div>
            )}
            {filtered.map((c) => {
              const isSelected = c.iso === value
              return (
                <button
                  key={c.iso}
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(c.iso)
                    setOpen(false)
                    setQuery("")
                  }}
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13.5px] transition-colors ${
                    isSelected ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="text-[16px] leading-none">{c.flag}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">
                    {c.name} <span className="tabular-nums text-slate-400">({c.dial})</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
