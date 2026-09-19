'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Compass, SlidersHorizontal } from 'lucide-react'
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
 * The sidebar already reaches every page, so this is not about reach. It
 * is about the four or five destinations a particular person opens
 * twenty times a day, and those differ: an agent lives in Inbox and
 * Leads, an owner in Reports and Broadcasts. The sidebar cannot be right
 * for both; a list chosen by the person using it can.
 *
 * ── The animation is doing a job ────────────────────────────────────
 *
 * A slow ring turning behind the button is what makes it findable at
 * all: it sits in a corner and carries no label until it is opened, and
 * a static circle in a corner reads as ornament. The motion is the
 * affordance. It stops entirely under prefers-reduced-motion, where the
 * ring stays put — visible, just not moving.
 *
 * ── Why it fetches rather than only taking a prop ───────────────────
 *
 * The auth context loads the profile once and keeps it. Saving a new
 * list in Settings and walking back to the dashboard is a client-side
 * navigation, so nothing refetched and the button kept showing the old
 * list — reported as "the selected option does not update". The prop is
 * still used for the first paint, so there is no flash of the default;
 * the fetch corrects it a moment later and after any save.
 */

interface QuickLinksProps {
  /** From the auth context, for the first paint. */
  links?: unknown
  /** From the auth context. False hides the button entirely. */
  enabled?: boolean
  /** Agents are not offered doors that will not open. */
  isAgent?: boolean
}

export function QuickLinks({ links, enabled, isAgent }: QuickLinksProps) {
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<{ links: string[]; enabled: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // The authoritative answer, asked for on mount. Cheap, and it is what
  // makes a change made in Settings visible without a hard reload.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me')
        if (!res.ok || cancelled) return
        const data = await res.json()
        setLive({
          links: sanitizeQuickLinks(data.profile?.quick_links),
          enabled: data.profile?.quick_links_enabled !== false,
        })
      } catch {
        /* the prop is a perfectly good fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const showing = live ?? { links: sanitizeQuickLinks(links), enabled: enabled !== false }
  if (!showing.enabled) return null

  // An empty list means "has not chosen", which is not "wants none" —
  // that is what the toggle above is for.
  const hrefs = showing.links.length > 0 ? showing.links : DEFAULT_QUICK_LINKS
  const items = hrefs
    .map((href) => navItemFor(href))
    .filter((i): i is NavItem => Boolean(i))
    .filter((i) => !isAgent || i.agentAllowed !== false)

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="fixed bottom-6 right-6 z-40 print:hidden">
      {open && (
        <div
          className={cn(
            'absolute bottom-[4.25rem] right-0 w-52 origin-bottom-right overflow-hidden rounded-2xl',
            'border border-slate-200/70 bg-white/95 backdrop-blur-sm',
            'shadow-[0_20px_44px_-18px_rgba(15,23,42,0.4)]',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
          )}
          role="menu"
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Quick links
            </span>
            <Link
              href="/settings?tab=profile"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
              title="Choose your quick links"
            >
              <SlidersHorizontal className="h-3 w-3" />
            </Link>
          </div>

          <nav className="p-1.5 pt-0.5">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className={cn(
                  // h-9, not the p-2 of a settings row: this is a jump
                  // list, read at a glance and never scrolled.
                  'group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-slate-600',
                  'transition-colors hover:bg-[#EEF0FF] hover:text-[#5B6CF9]',
                )}
              >
                <item.icon
                  className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-[#5B6CF9]"
                  strokeWidth={1.9}
                />
                <span className="truncate">{item.label}</span>
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
          'relative grid h-12 w-12 place-items-center rounded-full text-white outline-none',
          'bg-gradient-to-br from-[#6C7BFF] to-[#5B6CF9]',
          'shadow-[0_10px_24px_-8px_rgba(91,108,249,0.85)]',
          'transition-transform duration-200 focus-visible:ring-4 focus-visible:ring-[#5B6CF9]/30',
          'motion-safe:hover:scale-105 motion-safe:active:scale-95',
        )}
      >
        {/* The turning ring. Outside the icon, so the icon stays still
            and legible while the button advertises itself. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-[-3px] rounded-full',
            'border border-dashed border-[#5B6CF9]/40',
            'motion-safe:animate-[spin_11s_linear_infinite]',
          )}
        />
        <Compass
          className={cn('h-5 w-5 transition-transform duration-300', open && 'rotate-90')}
          strokeWidth={2}
        />
      </button>
    </div>
  )
}
