"use client"

import { CheckSquare } from "lucide-react"
import type { MyTasks, TaskGroup, TaskItem, TeamTasks } from "@/lib/dashboard/owner-types"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { MaybeLink, Section } from "./shared"

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

function Group({
  title, group, tone, zone, showTime, allowed,
}: {
  title: string
  group: TaskGroup
  tone: string
  zone: string
  showTime: boolean
  allowed: string[] | null | undefined
}) {
  return (
    <div className="min-w-0">
      <h3 className={cn("mb-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>
        {title} <span className="tabular-nums">{group.count}</span>
      </h3>
      {group.items.length === 0 ? (
        <p className="text-[12px] text-slate-500">Nothing here.</p>
      ) : (
        <ul className="list-none divide-y divide-slate-100 p-0">
          {group.items.map((it: TaskItem) => {
            const time = showTime ? timeIn(it.dueAt, zone) : ""
            const row = (
              <span className="flex min-w-0 items-baseline gap-2 py-1.5 text-[13px]">
                {time ? <span className="w-16 shrink-0 text-[12px] tabular-nums text-slate-600">{time}</span> : null}
                <span className="min-w-0 flex-1 break-words text-slate-800">{it.title || "Untitled"}</span>
              </span>
            )
            return (
              <li key={`${it.kind}-${it.id}`}>
                {it.leadId ? (
                  <MaybeLink href={`/leads/${it.leadId}`} allowed={allowed} className="block rounded-md hover:bg-slate-50">
                    {row}
                  </MaybeLink>
                ) : row}
              </li>
            )
          })}
          {group.count > group.items.length ? (
            <li className="py-1.5 text-[11.5px] text-slate-500">and {group.count - group.items.length} more</li>
          ) : null}
        </ul>
      )}
    </div>
  )
}

export function TasksSection({
  tasks, teamTasks, zone, allowed,
}: {
  tasks: MyTasks
  teamTasks: TeamTasks | null
  zone: string
  allowed: string[] | null | undefined
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
        <div className="grid gap-4 md:grid-cols-3">
          <Group title="Overdue" group={tasks.overdue} tone="bg-rose-50 text-rose-700" zone={zone} showTime={false} allowed={allowed} />
          <Group title="Due today" group={tasks.dueToday} tone="bg-indigo-50 text-indigo-700" zone={zone} showTime allowed={allowed} />
          <Group title="New for me" group={tasks.newLeads} tone="bg-emerald-50 text-emerald-700" zone={zone} showTime={false} allowed={allowed} />
        </div>
      )}
      {teamTasks ? (
        <p className="mt-3 break-words border-t border-slate-100 pt-2 text-[12px] text-slate-600">
          Team: {teamTasks.overdue} overdue · {teamTasks.dueToday} due today · {teamTasks.newLeads} new leads waiting
        </p>
      ) : null}
      <div className="mt-2 text-[12.5px]">
        <MaybeLink href="/leads?tab=tasks" allowed={allowed} className="font-semibold text-indigo-700 underline underline-offset-2">
          Open all tasks
        </MaybeLink>
      </div>
    </Section>
  )
}
