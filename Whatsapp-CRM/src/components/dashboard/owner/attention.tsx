"use client"

import { AlertTriangle, CalendarClock, CheckCircle2, MessageSquare, PhoneMissed, UserCheck, UserPlus } from "lucide-react"
import type { ComponentType } from "react"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { cn } from "@/lib/utils"
import { MaybeLink } from "./shared"
import { followUpHref, formatMinutes, minutesSince } from "./view-model"

type Tone = "rose" | "amber" | "indigo"
const TONE: Record<Tone, string> = {
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
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
    <ul className="grid list-none grid-cols-2 gap-2.5 p-0 sm:gap-3 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]" aria-label="Needs attention">
      {tiles.map((t) => {
        const n = t.n ?? 0
        const urgent = n > 0
        const Icon = urgent ? t.icon : CheckCircle2
        return (
          <li key={t.key} className="min-w-0">
            <MaybeLink
              href={t.href}
              allowed={allowed}
              className={cn(
                "flex h-full min-w-0 flex-col gap-1 rounded-xl border p-3 transition-colors hover:brightness-[0.98]",
                urgent ? TONE[t.tone] : "border-slate-200 bg-white text-slate-700",
              )}
            >
              <span className="flex items-start gap-1.5 text-[12px] font-semibold">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-words">{t.label}</span>
              </span>
              <span className="text-[26px] font-bold leading-none tabular-nums">{n.toLocaleString()}</span>
              {urgent ? (
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/70 px-1.5 py-0.5 text-[10.5px] font-semibold">
                  <AlertTriangle aria-hidden className="size-3" /> Needs action
                </span>
              ) : (
                <span className="text-[11.5px] font-semibold text-emerald-700">All clear</span>
              )}
              <span className="min-w-0 break-words text-[11.5px]">{t.context}</span>
              <span className="mt-auto pt-1 text-[12px] font-semibold underline underline-offset-2">{t.linkText}</span>
            </MaybeLink>
          </li>
        )
      })}
    </ul>
  )
}
