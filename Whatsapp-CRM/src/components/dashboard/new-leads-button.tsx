'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { everyWhileVisible } from '@/lib/visible-interval'

/**
 * An agent's main button on the dashboard: Leads, with how many are
 * waiting to be picked up — New Pool plus their own untouched ones.
 *
 * An agent does not start conversations from here; their day starts
 * with leads, so this is where "New Message" used to be. While anything
 * is waiting the badge pulses so it is seen at a glance; with nothing
 * waiting it sits still. Motion stops under prefers-reduced-motion.
 *
 * The count is the dashboard's first load, then refreshed every minute
 * while the tab is visible, so a lead arriving mid-morning shows up
 * without a reload.
 */
export function NewLeadsButton({ initial }: { initial: number | null }) {
  const [count, setCount] = useState<number | null>(initial)
  const loadSeq = useRef(0)

  useEffect(() => {
    setCount(initial)
  }, [initial])

  useEffect(() => {
    const refresh = () => {
      const seq = ++loadSeq.current
      fetch('/api/dashboard?section=new-leads', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { newLeads?: number | null } | null) => {
          if (seq !== loadSeq.current || !d || typeof d.newLeads !== 'number') return
          setCount(d.newLeads)
        })
        .catch((err) => console.warn('[dashboard] new leads count', err))
    }
    return everyWhileVisible(refresh, 60_000)
  }, [])

  const waiting = (count ?? 0) > 0

  return (
    <Link
      href="/leads?tab=new_pool"
      aria-label={waiting ? `Leads — ${count} new waiting` : 'Leads'}
      className="relative flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[var(--primary-hover)]"
    >
      <TrendingUp className="h-4 w-4" />
      Leads
      {waiting && (
        <span className="relative ml-1 flex">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-amber-300 opacity-75 motion-safe:animate-ping"
          />
          <span
            className={cn(
              'relative grid h-6 min-w-6 place-items-center rounded-full bg-amber-400 px-1.5 text-[12px] font-bold tabular-nums text-amber-950 ring-2 ring-white',
              'motion-safe:animate-bounce',
            )}
          >
            {count! > 99 ? '99+' : count}
          </span>
        </span>
      )}
    </Link>
  )
}
