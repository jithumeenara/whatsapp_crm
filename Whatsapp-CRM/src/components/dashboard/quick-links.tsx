'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Compass, Settings2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_QUICK_LINKS,
  navItemFor,
  sanitizeQuickLinks,
  type NavItem,
} from '@/lib/navigation/sections'

/**
 * A round button on the dashboard that opens somebody's own shortcuts.
 *
 * The sidebar already lists every page, so this is not about reach — it
 * is about the four or five places a particular person goes twenty times
 * a day. An agent lives in Inbox and Leads; an owner lives in Reports
 * and Broadcasts. The sidebar cannot be right for both, and a shortcut
 * list chosen by the person using it can.
 *
 * ── The animation is doing a job ────────────────────────────────────
 *
 * A slow ring turning behind the button is what makes it findable at
 * all: it sits in a corner, it has no label until it is opened, and a
 * static circle in a corner reads as decoration. The motion is the
 * affordance. It stops entirely under prefers-reduced-motion, where the
 * ring simply stays put — visible, just not moving.
 */

interface QuickLinksProps {
  /** As stored on the profile. Empty means "has not chosen", which is
   *  not the same as "wants none" — see DEFAULT_QUICK_LINKS. */
  links?: unknown
  /** Agents are not offered doors that will not open. */
  isAgent?: boolean
}

export function QuickLinks({ links, isAgent }: QuickLinksProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const chosen = sanitizeQuickLinks(links)
  const hrefs = chosen.length > 0 ? chosen : DEFAULT_QUICK_LINKS
  const items = hrefs
    .map((href) => navItemFor(href))
    .filter((i): i is NavItem => Boolean(i))
    .filter((i) => !isAgent || i.agentAllowed !== false)

  // Closing rules, both of them the ones people expect without being
  // told: click anywhere else, or press Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="fixed bottom-6 right-6 z-40 print:hidden">
      {open && (
        <div
          className={cn(
            'absolute bottom-16 right-0 w-60 origin-bottom-right overflow-hidden rounded-2xl',
            'border border-slate-200/80 bg-white shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)]',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-150',
          )}
          role="menu"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
              Quick links
            </span>
            <Link
              href="/settings?tab=profile"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="Choose your quick links"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Link>
          </div>

          <nav className="p-1.5">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-slate-700',
                  'transition-colors hover:bg-[#EEF0FF] hover:text-[#5B6CF9]',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.9} />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close quick links' : 'Open quick links'}
        className={cn(
          'relative grid h-14 w-14 place-items-center rounded-full text-white outline-none',
          'bg-gradient-to-br from-[#6C7BFF] to-[#5B6CF9]',
          'shadow-[0_12px_28px_-10px_rgba(91,108,249,0.9)]',
          'transition-transform duration-200 focus-visible:ring-4 focus-visible:ring-[#5B6CF9]/30',
          'motion-safe:hover:scale-105 motion-safe:active:scale-95',
        )}
      >
        {/* The turning ring. Outside the icon so the icon itself stays
            still and legible while the button advertises itself. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-[-3px] rounded-full',
            'border-2 border-dashed border-[#5B6CF9]/45',
            'motion-safe:animate-[spin_9s_linear_infinite]',
          )}
        />
        <Compass
          className={cn(
            'h-6 w-6 transition-transform duration-300',
            open && 'rotate-90',
          )}
          strokeWidth={1.9}
        />
        {open && (
          <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[#5B6CF9] shadow">
            <X className="h-3 w-3" strokeWidth={2.4} />
          </span>
        )}
      </button>
    </div>
  )
}
