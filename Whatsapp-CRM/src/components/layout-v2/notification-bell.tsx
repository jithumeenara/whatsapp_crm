"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlarmClock, Bell, CalendarClock, PhoneMissed, UserPlus } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"
import type { Bell as BellData, BellKey } from "@/lib/notifications/bell"
import { cn } from "@/lib/utils"

/** Once a minute is fresh enough for counts; the alerts that must ring
 *  (calls, offers, call-backs) have their own channels. */
const POLL_MS = 60_000

const ICON: Record<BellKey, typeof Bell> = {
  overdue: AlarmClock,
  today: CalendarClock,
  new: UserPlus,
  missed: PhoneMissed,
}
const TONE: Record<BellKey, string> = {
  overdue: "text-rose-700 bg-rose-50",
  today: "text-amber-700 bg-amber-50",
  new: "text-indigo-700 bg-indigo-50",
  missed: "text-violet-700 bg-violet-50",
}

export function badgeText(total: number): string {
  return total > 99 ? "99+" : String(total)
}

/**
 * The bell: what is waiting for this person right now, as live counts.
 * Each row opens the list behind its number.
 */
export function NotificationBell({ className, side = "bottom", align = "end" }: {
  className?: string
  side?: "bottom" | "right"
  align?: "start" | "end"
}) {
  const [data, setData] = useState<BellData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await apiFetch("/api/notifications/bell", { cache: "no-store" })
      const body = (await res.json()) as BellData
      if (seq !== loadSeq.current) return
      setData({ items: Array.isArray(body?.items) ? body.items : [], total: Number(body?.total) || 0 })
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[notification-bell] load failed", err)
      setError(errorText(err, "Could not load notifications."))
    }
  }, [])

  // First load right after mount (outside the render pass), then once a
  // minute while the tab is visible.
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0)
    const stop = everyWhileVisible(() => void load(), POLL_MS)
    return () => { window.clearTimeout(first); stop() }
  }, [load])

  // Moving to another page refreshes the counts.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [pathname, load])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void load() // opening the bell shows fresh numbers
  }

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const label = total > 0 ? `Notifications: ${total} waiting` : "Notifications"

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800",
          className,
        )}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {total > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-white"
          >
            {badgeText(total)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[min(20rem,calc(100vw-2rem))] gap-0 bg-white p-0 text-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <p className="text-[13px] font-semibold">Notifications</p>
          <p className="text-[11.5px] text-slate-500" aria-live="polite">{total > 0 ? `${total} waiting` : "All clear"}</p>
        </div>
        {error && <p className="px-3 py-2 text-[12.5px] text-rose-700" role="alert">{error}</p>}
        {!data && !error ? (
          <p className="px-3 py-4 text-[12.5px] text-slate-500" role="status">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-slate-500">Nothing here for you.</p>
        ) : (
          <ul className="list-none p-1">
            {items.map((i) => {
              const Icon = ICON[i.key] ?? Bell
              return (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] hover:bg-slate-50"
                  >
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", TONE[i.key])}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 break-words text-slate-700">{i.label}</span>
                    <span className={cn("shrink-0 font-semibold tabular-nums", i.count > 0 ? "text-slate-900" : "text-slate-400")}>
                      {i.count.toLocaleString()}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
