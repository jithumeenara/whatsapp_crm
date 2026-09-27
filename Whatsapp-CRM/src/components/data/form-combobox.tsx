"use client"

/**
 * A dropdown you can type into, for lists too long to scan — a
 * programme list, a district list. The answer is always one of the
 * options: typing only narrows the list, it never becomes the value.
 * Keyboard: ↑ ↓ to move, Enter to pick, Esc to close.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search } from "lucide-react"

interface Props {
  id: string
  value: string
  options: string[]
  onChange(value: string): void
  onBlur?(): void
  placeholder: string
  searchPlaceholder: string
  noMatch: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

export function FormCombobox({
  id, value, options, onChange, onBlur, placeholder, searchPlaceholder, noMatch, disabled, invalid, describedBy,
}: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        onBlur?.()
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, onBlur])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function openList() {
    if (disabled) return
    setQuery("")
    setActive(Math.max(0, options.indexOf(value)))
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function pick(option: string) {
    onChange(option)
    setOpen(false)
    onBlur?.()
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
        aria-describedby={describedBy}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3.5 py-3 text-left text-[16px] outline-none transition focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-50 ${invalid ? "border-rose-300" : "border-slate-300"}`}
      >
        <span className={`min-w-0 flex-1 truncate ${value ? "text-slate-900" : "text-slate-400"}`}>{value || placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              role="combobox"
              aria-controls={listId}
              aria-expanded={open}
              aria-autocomplete="list"
              aria-activedescendant={shown[active] !== undefined ? `${listId}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)) }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
                else if (e.key === "Enter") { e.preventDefault(); if (shown[active] !== undefined) pick(shown[active]) }
                else if (e.key === "Escape") { e.preventDefault(); setOpen(false) }
              }}
              placeholder={searchPlaceholder}
              autoComplete="off"
              className="w-full bg-transparent py-3 pl-9 pr-3 text-[15px] outline-none placeholder:text-slate-400"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 ? (
              <li className="px-3 py-3 text-[14px] text-slate-400">{noMatch}</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={o === value}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] ${i === active ? "bg-primary/10 text-slate-900" : "text-slate-700"}`}
                >
                  <span className="min-w-0 flex-1 break-words">{o}</span>
                  {o === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
