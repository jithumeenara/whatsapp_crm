'use client'

/**
 * A word in the report sentence that opens into its choices.
 *
 * The sentence reads like English ("How many · Leads won · by Source ·
 * last 90 days"); each highlighted word is one of these. Opening it shows
 * every choice with a line saying what it means, grouped and searchable —
 * a dropdown that explains itself instead of a bare list of names.
 *
 * Built by hand rather than on the popover library: it needs to measure
 * itself against the screen edge on a phone, and to keep keyboard focus
 * inside a list that filters as you type.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

export interface TokenOption {
  value: string
  label: string
  description?: string
  group?: string
  icon?: React.ReactNode
  disabled?: boolean
}

export function TokenSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Choose…',
  muted = false,
  widthClass = 'w-80',
}: {
  value: string
  options: TokenOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  /** A quieter chip, for optional parts of the sentence. */
  muted?: boolean
  widthClass?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const current = options.find((o) => o.value === value)
  const searchable = options.length > 8

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => `${o.label} ${o.description ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Open towards whichever side has room, so the list never runs off a
  // phone's screen.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !rootRef.current) return
    const chip = rootRef.current.getBoundingClientRect()
    const width = panelRef.current.offsetWidth
    setAlignRight(chip.left + width > window.innerWidth - 12)
  }, [open])

  // Focus moves into the list as it opens: the search box when there is
  // one, otherwise the chosen option.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => (searchable ? searchRef.current?.focus() : panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus()), 0)
    return () => clearTimeout(t)
  }, [open, searchable])

  function toggle() {
    if (!open) {
      setQuery('')
      setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    }
    setOpen(!open)
  }

  function choose(o: TokenOption) {
    if (o.disabled) return
    onChange(o.value)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        let n = i
        for (let k = 0; k < visible.length; k++) {
          n = (n + step + visible.length) % visible.length
          if (!visible[n]?.disabled) break
        }
        return n
      })
    }
    if (e.key === 'Enter' && visible[active]) {
      e.preventDefault()
      choose(visible[active])
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={open ? onKeyDown : undefined}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
        className={cn(
          'inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13.5px] font-semibold transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
          muted
            ? 'border-dashed border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
            : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100',
          open && 'ring-2 ring-indigo-200',
        )}
      >
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className={cn(
            'absolute top-full z-50 mt-2 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl',
            widthClass,
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                id={`${listId}-search`}
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                placeholder="Search…"
                className="w-full bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
          )}
          <div id={listId} role="listbox" aria-label={ariaLabel} className="max-h-80 overflow-y-auto p-1.5">
            {visible.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-slate-400">Nothing matches.</p>}
            {visible.map((o, i) => {
              const header = o.group && o.group !== visible[i - 1]?.group ? o.group : null
              const selected = o.value === value
              return (
                <div key={o.value}>
                  {header && (
                    <p className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{header}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={i === active}
                    disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left focus:outline-none',
                      i === active && 'bg-slate-50',
                      o.disabled && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    {o.icon && <span className="mt-0.5 shrink-0">{o.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[13px]', selected ? 'font-semibold text-indigo-700' : 'font-medium text-slate-800')}>{o.label}</span>
                      {o.description && <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{o.description}</span>}
                    </span>
                    {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
