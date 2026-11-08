"use client"

import { AlarmClock, CalendarClock, CheckSquare, UserPlus } from "lucide-react"
import type { ComponentType } from "react"
import type { MyTasks, TaskGroup, TaskItem, TeamTasks } from "@/lib/dashboard/owner-types"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { MaybeLink, Section } from "./shared"
import { formatMinutes, minutesSince, sourceName } from "./view-model"

function timeIn(iso: string | null, zone: string): string {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  try {
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(t)
  } catch {
    return ""
  }
}

/** "1 day 2 h", "45 min": how long ago an ISO time was. Empty when unknown. */
function since(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  return formatMinutes(minutesSince(nowMs, t))
}

type Kind = "overdue" | "today" | "new"
const LOOK: Record<Kind, { icon: ComponentType<{ className?: string }>; chip: string; count: string; pill: string }> = {
  overdue: { icon: AlarmClock, chip: "bg-rose-50 text-rose-700 ring-rose-100", count: "text-rose-700", pill: "bg-rose-50 text-rose-700" },
  today: { icon: CalendarClock, chip: "bg-indigo-50 text-indigo-700 ring-indigo-100", count: "text-indigo-700", pill: "bg-indigo-50 text-indigo-700" },
  new: { icon: UserPlus, chip: "bg-emerald-50 text-emerald-700 ring-emerald-100", count: "text-emerald-700", pill: "bg-emerald-50 text-emerald-700" },
}

function detailFor(kind: Kind, it: TaskItem, zone: string, nowMs: number): { side: string; sub: string } {
  if (kind === "overdue") {
    const late = since(it.dueAt, nowMs)
    return { side: late ? `${late} late` : "", sub: it.leadTitle ? `Lead: ${it.leadTitle}` : it.leadId ? "" : "No lead attached" }
  }
  if (kind === "today") return { side: timeIn(it.dueAt, zone), sub: it.leadTitle ? `Lead: ${it.leadTitle}` : "" }
  const ago = since(it.createdAt, nowMs)
  return { side: ago ? `${ago} ago` : "", sub: it.source ? sourceName(it.source) : "" }
}

function GroupTile({
  kind, title, group, zone, nowMs, href, allowed,
}: {
  kind: Kind
  title: string
  group: TaskGroup
  zone: string
  nowMs: number
  href: string
  allowed: string[] | null | undefined
}) {
  const look = LOOK[kind]
  const Icon = look.icon
  const more = group.count - group.items.length
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center gap-2.5">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg ring-1", look.chip)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <h3 className="min-w-0 flex-1 break-words text-[13px] font-semibold text-slate-800">{title}</h3>
        <span className={cn("text-[22px] font-bold leading-none tracking-tight tabular-nums", group.count > 0 ? look.count : "text-slate-400")}>
          {group.count.toLocaleString()}
        </span>
      </div>

      {group.items.length === 0 ? (
        <p className="rounded-lg bg-white px-3 py-3 text-[12px] text-slate-500">Nothing here.</p>
      ) : (
        <ul className="list-none space-y-1.5 p-0">
          {group.items.map((it) => {
            const d = detailFor(kind, it, zone, nowMs)
            const row = (
              <span className="flex min-w-0 items-start gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200/70">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] font-medium leading-snug text-slate-800">{it.title || "Untitled"}</span>
                  {d.sub ? <span className="mt-0.5 block break-words text-[11.5px] text-slate-500">{d.sub}</span> : null}
                </span>
                {d.side ? (
                  <span className={cn("shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", look.pill)}>{d.side}</span>
                ) : null}
              </span>
            )
            return (
              <li key={`${it.kind}-${it.id}`}>
                {it.leadId ? (
                  <MaybeLink href={`/leads/${it.leadId}`} allowed={allowed} className="block rounded-lg transition-shadow hover:shadow-card-md">
                    {row}
                  </MaybeLink>
                ) : row}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-auto pt-2 text-[12px]">
        <MaybeLink href={href} allowed={allowed} className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-indigo-700">
          {more > 0 ? `View all ${group.count.toLocaleString()}` : "Open list"} <span aria-hidden>→</span>
        </MaybeLink>
      </div>
    </div>
  )
}

function TeamChip({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] text-slate-600">
      <span className="font-bold tabular-nums text-slate-900">{n.toLocaleString()}</span> {label}
    </span>
  )
}

export function TasksSection({
  tasks, teamTasks, zone, allowed, nowMs,
}: {
  tasks: MyTasks
  teamTasks: TeamTasks | null
  zone: string
  allowed: string[] | null | undefined
  nowMs: number
}) {
  const empty = tasks.overdue.count + tasks.dueToday.count + tasks.newLeads.count === 0
  return (
    <Section
      title="Your tasks"
      hint={`Today: ${tasks.todayTotal} · ${tasks.pendingLeads} open leads · ${tasks.pendingFollowUps} pending follow-ups`}
    >
      {empty ? (
        <EmptyState
          icon={<CheckSquare />}
          title="Nothing to do right now"
          description="Overdue follow-ups, calls due today and new leads for you will show up here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <GroupTile kind="overdue" title="Overdue" group={tasks.overdue} zone={zone} nowMs={nowMs} href="/follow-ups?due=overdue&mine=1" allowed={allowed} />
          <GroupTile kind="today" title="Due today" group={tasks.dueToday} zone={zone} nowMs={nowMs} href="/follow-ups?due=today&mine=1" allowed={allowed} />
          <GroupTile kind="new" title="New for me" group={tasks.newLeads} zone={zone} nowMs={nowMs} href="/leads?tab=tasks&group=new" allowed={allowed} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        {teamTasks ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Team">
            <span className="text-[11.5px] font-semibold text-slate-500">Team</span>
            <TeamChip label="overdue" n={teamTasks.overdue} />
            <TeamChip label="due today" n={teamTasks.dueToday} />
            <TeamChip label="new leads waiting" n={teamTasks.newLeads} />
          </div>
        ) : <span />}
        <MaybeLink href="/leads?tab=tasks" allowed={allowed} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-3 text-[12.5px] font-semibold text-white hover:bg-slate-800">
          Open all tasks <span aria-hidden>→</span>
        </MaybeLink>
      </div>
    </Section>
  )
}
