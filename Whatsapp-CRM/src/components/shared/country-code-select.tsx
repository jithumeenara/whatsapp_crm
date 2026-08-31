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
 * Facebook/WhatsApp-style country code picker: a compact trigger showing
 * the selected flag + dial code, opening a searchable list on click —
 * instead of a plain native <select> (which can't show a search box or
 * a flag+name+code row layout).
 */
export function CountryCodeSelect({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
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
        className="flex h-11 w-full items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-2.5 text-[13px] text-slate-900 outline-none transition-all hover:bg-slate-100 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
      >
        <span className="text-[15px] leading-none">{selected.flag}</span>
        <span className="font-medium tabular-nums">{selected.dial}</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
        >
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[13px] text-slate-900 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="max-h-[248px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No matching country</div>
            )}
            {filtered.map((c) => {
              const isSelected = c.iso === value
              return (
                <button
                  key={c.iso}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(c.iso)
                    setOpen(false)
                    setQuery("")
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  {/* Radio indicator — matches the pick-one-of-many pattern from
                      Meta's own number-selection UI (empty ring, filled dot when chosen) */}
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isSelected ? "border-indigo-600" : "border-slate-300"
                    }`}
                  >
                    {isSelected && <span className="h-2 w-2 rounded-full bg-indigo-600" />}
                  </span>
                  <span className="text-[15px] leading-none">{c.flag}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-[13px] ${isSelected ? "font-semibold text-indigo-700" : "font-medium text-slate-800"}`}>
                      {c.iso} <span className="tabular-nums">{c.dial}</span>
                    </span>
                    <span className="truncate text-[11.5px] text-slate-400">{c.name}</span>
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
