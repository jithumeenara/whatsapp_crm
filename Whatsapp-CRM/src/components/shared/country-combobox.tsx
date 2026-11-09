"use client"

/**
 * A country picker you can type into: flag, name, calling code and currency
 * on every row, from the full ISO list.
 *
 * Typing narrows the list by name, calling code (+91 or 91), currency code or
 * a common name (UAE, USA, UK). The answer is always a country from the list.
 * Keyboard: ↑ ↓ to move, Home / End to jump, Enter to pick, Esc to close.
 *
 * The flag is an SVG (flag-icons), never an emoji: Windows shows emoji flags
 * as two bare letters. It is decorative; the country's name is always in the
 * text beside it.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import { countryByIso, flagClass, searchCountries } from "@/lib/countries"

interface Props {
  id?: string
  /** ISO 3166-1 alpha-2, or "" when none is chosen. */
  value: string
  onChange(iso: string): void
  disabled?: boolean
  placeholder?: string
}

function Flag({ iso }: { iso: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${flagClass(iso)} shrink-0 rounded-[3px]`}
      style={{ width: "1.333em", height: "1em" }}
    />
  )
}

export function CountryCombobox({ id, value, onChange, disabled, placeholder = "Choose a country" }: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = countryByIso(value)
  const shown = useMemo(() => searchCountries(query), [query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function openList() {
    if (disabled) return
    setQuery("")
    setActive(Math.max(0, searchCountries("").findIndex((c) => c.iso === value)))
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function pick(iso: string) {
    onChange(iso)
    setOpen(false)
    // Back on the button, so a keyboard user is not dropped at the top of the page.
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>("button")?.focus())
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openList()
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Country: ${selected.name}, ${selected.dial}, ${selected.currency}` : "Country: none chosen"}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-start text-[13px] outline-none transition hover:border-slate-300 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        {selected ? (
          <>
            <Flag iso={selected.iso} />
            <span className="min-w-0 flex-1 truncate text-slate-900">{selected.name}</span>
            <span className="shrink-0 text-slate-500">{selected.dial}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-slate-400">{placeholder}</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* The input has no outline of its own, so the ring sits on its wrapper. */}
          <div className="relative border-b border-slate-100 focus-within:bg-primary/5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary/30">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search countries"
              aria-controls={listId}
              aria-expanded={open}
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${listId}-${shown[active].iso}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)) }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
                else if (e.key === "Home") { e.preventDefault(); setActive(0) }
                else if (e.key === "End") { e.preventDefault(); setActive(Math.max(0, shown.length - 1)) }
                else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active].iso) }
                else if (e.key === "Escape") {
                  e.preventDefault()
                  setOpen(false)
                  // Focus goes back to the button instead of vanishing with the list.
                  requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>("button")?.focus())
                }
              }}
              placeholder="Name, +91 or INR"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full bg-transparent py-3 ps-9 pe-3 text-[16px] outline-none placeholder:text-slate-400"
            />
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {shown.length === 0 ? "No matching country" : `${shown.length} countries`}
          </p>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Countries" className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {shown.length === 0 ? (
              <li className="px-3 py-3 text-[13px] text-slate-500">No matching country.</li>
            ) : (
              shown.map((c, i) => (
                <li
                  key={c.iso}
                  id={`${listId}-${c.iso}`}
                  data-index={i}
                  role="option"
                  aria-selected={c.iso === value}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.iso)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-[14px] ${i === active ? "bg-primary/10 text-slate-900" : "text-slate-700"}`}
                >
                  <Flag iso={c.iso} />
                  <span className="min-w-0 flex-1 break-words">{c.name}</span>
                  <span className="shrink-0 text-[12px] text-slate-500">{c.dial} · {c.currency}</span>
                  {c.iso === value && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
