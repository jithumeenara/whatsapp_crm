"use client"

import { CalendarClock, CheckCircle2, MessageSquare, PhoneMissed, UserCheck, UserPlus } from "lucide-react"
import type { ComponentType } from "react"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { ArrowChip, CARD, MaybeLink } from "./shared"
import { followUpHref, formatMinutes, minutesSince } from "./view-model"

type Tone = "rose" | "amber" | "indigo"
/** Icon chip and number colour; the card itself stays white. */
const CHIP: Record<Tone, string> = {
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-800",
  indigo: "bg-indigo-50 text-indigo-700",
}
const DOT: Record<Tone, string> = {
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  indigo: "bg-indigo-500",
}
const NUMBER: Record<Tone, string> = {
  rose: "text-rose-700",
  amber: "text-amber-800",
  indigo: "text-indigo-700",
}

interface Tile {
  key: string
  label: string
  n: number
  context: string
  href: string
  linkText: string
  tone: Tone
  icon: ComponentType<{ className?: string }>
}

function buildTiles(d: OwnerDashboard, nowMs: number): Tile[] {
  const a = d.attention
  const tiles: Tile[] = []
  tiles.push({
    key: "overdue", label: "Overdue follow-ups", n: a.overdueFollowUps, tone: "rose", icon: CalendarClock,
    context: "Past their time and not done", href: followUpHref("overdue", d.view), linkText: "Open list",
  })
  const since = a.oldestWaitingChatSince ? Date.parse(a.oldestWaitingChatSince) : NaN
  tiles.push({
    key: "waiting", label: "Customers waiting for a reply", n: a.waitingChats, tone: "amber", icon: MessageSquare,
    context: Number.isFinite(since) && (a.waitingChats ?? 0) > 0
      ? `Oldest waiting ${formatMinutes(minutesSince(nowMs, since))}. Waiting more than ${a.leakHours} h`
      : `Waiting more than ${a.leakHours} h`,
    href: "/inbox", linkText: "Open inbox",
  })
  tiles.push({
    key: "never", label: "Leads nobody has contacted", n: a.neverContacted, tone: "amber", icon: UserPlus,
    context: `Older than ${a.leakHours} h`,
    href: d.view === "agent" ? "/leads?tab=mine" : "/leads?tab=all", linkText: "Open leads",
  })
  if (a.missedCallsToday !== null) {
    tiles.push({
      key: "missed", label: "Missed or declined calls today", n: a.missedCallsToday, tone: "indigo", icon: PhoneMissed,
      context: "Not picked up or declined today", href: "/calls?status=missed&day=today", linkText: "Open calls",
    })
  }
  if (a.unassigned !== null) {
    tiles.push({
      key: "unassigned", label: "Unassigned leads", n: a.unassigned, tone: "indigo", icon: UserCheck,
      context: "Waiting in the new pool", href: "/leads?tab=new_pool", linkText: "Open pool",
    })
  }
  return tiles
}

export function AttentionTiles({ data, allowed, nowMs }: { data: OwnerDashboard; allowed: string[] | null | undefined; nowMs: number }) {
  const tiles = buildTiles(data, nowMs)
  return (
    <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]" aria-label="Needs attention">
      {tiles.map((t) => {
        const n = t.n ?? 0
        const urgent = n > 0
        const Icon = urgent ? t.icon : CheckCircle2
        return (
          <li key={t.key} className="min-w-0">
            <MaybeLink
              href={t.href}
              allowed={allowed}
              ariaLabel={`${t.label}: ${n.toLocaleString()}. ${urgent ? "Needs action." : "All clear."} ${t.linkText}`}
              className={cn(
                CARD,
                "group flex h-full min-w-0 flex-col p-4 text-slate-700 sm:p-5",
                "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(15,23,42,0.10)]",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={cn("flex size-10 items-center justify-center rounded-2xl", urgent ? CHIP[t.tone] : "bg-emerald-50 text-emerald-700")}>
                  <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                <ArrowChip />
              </span>
              <span className={cn("mt-4 text-[32px] font-semibold leading-none tracking-tight tabular-nums", urgent ? NUMBER[t.tone] : "text-slate-900")}>
                {n.toLocaleString()}
              </span>
              <span className="mt-2 min-w-0 break-words text-[13px] leading-snug text-slate-500">{t.label}</span>
              <span className="mt-3 flex min-w-0 items-start gap-1.5 text-[11.5px] leading-snug">
                <span aria-hidden className={cn("mt-1 size-1.5 shrink-0 rounded-full", urgent ? DOT[t.tone] : "bg-emerald-500")} />
                <span className="min-w-0 break-words text-slate-500">
                  <span className={cn("font-semibold", urgent ? "text-slate-800" : "text-emerald-700")}>{urgent ? "Needs action" : "All clear"}</span>
                  {" · "}{t.context}
                </span>
              </span>
            </MaybeLink>
          </li>
        )
      })}
    </ul>
  )
}
