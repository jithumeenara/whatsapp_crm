"use client"

/**
 * The Leads page "Tasks" tab: one person's list for today.
 *
 *  - Overdue:   their pending follow-ups that are late.
 *  - Due today: their pending follow-ups for today, with the time the
 *               customer asked to be called (business time zone).
 *  - New for me: leads still new that are theirs.
 *
 * The server builds the lists (GET /api/my-tasks, type `MyTasks`); this only
 * draws them. Open leads and pending follow-ups are counted separately in
 * the header and never added.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CalendarClock, CheckCircle2, Sparkles } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { useAuth } from "@/hooks/use-auth"
import { linkOrText } from "@/components/dashboard/owner/view-model"
import { everyWhileVisible } from "@/lib/visible-interval"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBanner } from "@/components/ui/error-banner"
import type { MyTasks, TaskGroup, TaskItem } from "@/lib/dashboard/owner-types"
import {
  formatDueTime,
  lateLabel,
  parseTaskGroup,
  showingLabel,
  summaryLine,
  waitingLabel,
  type TaskGroupKey,
} from "@/lib/leads/my-tasks-view"

/** The contract's item plus fields the server may add for display. Read
 *  defensively: nothing here may be assumed present. */
type Row = TaskItem & {
  leadTitle?: string | null
  source?: string | null
  createdAt?: string | null
}

const STEPS = [10, 50, 200] as const
const POLL_MS = 60_000
/** Used only until the first response says which zone the business keeps. */
const FALLBACK_ZONE = "Asia/Kolkata"

type Limits = Record<TaskGroupKey, number>
const API_GROUP: Record<TaskGroupKey, string> = { overdue: "overdue", today: "today", new: "new" }
type Reply = { tasks?: MyTasks; timeZone?: string }

const EMPTY: Record<TaskGroupKey, string> = {
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  new: "No new leads for you.",
}

export function MyTasksTab({
  initialGroup,
  reloadKey = 0,
  onCount,
}: {
  /** From `?group=overdue|today|new`: scroll to and highlight that section. */
  initialGroup?: string | null
  /** Bumped by the page's Refresh button. */
  reloadKey?: number
  /** Tells the page header how many tasks there are. */
  onCount?: (n: number) => void
}) {
  const [tasks, setTasks] = useState<MyTasks | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limits, setLimits] = useState<Limits>({ overdue: STEPS[0], today: STEPS[0], new: STEPS[0] })
  const [zone, setZone] = useState(FALLBACK_ZONE)
  const [now, setNow] = useState(() => new Date())
  const focusGroup = parseTaskGroup(initialGroup)
  const [highlight, setHighlight] = useState<TaskGroupKey | null>(focusGroup)
  const scrolled = useRef(false)
  const refs = useRef<Partial<Record<TaskGroupKey, HTMLElement | null>>>({})

  // Each load is numbered and only the newest may write to the screen.
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const get = async (group: string, n: number) => {
        const res = await apiFetch(`/api/my-tasks?group=${group}&limit=${n}`)
        const b = (await res.json()) as Reply
        if (!b.tasks) throw new Error("The server sent no tasks")
        return b
      }
      let body: Reply & { tasks: MyTasks }
      if (limits.overdue === STEPS[0] && limits.today === STEPS[0] && limits.new === STEPS[0]) {
        body = (await get("all", STEPS[0])) as Reply & { tasks: MyTasks }
      } else {
        // A group that was widened asks for its own number of rows.
        const [o, t, n] = await Promise.all([
          get(API_GROUP.overdue, limits.overdue),
          get(API_GROUP.today, limits.today),
          get(API_GROUP.new, limits.new),
        ])
        body = {
          timeZone: o.timeZone,
          tasks: { ...(o.tasks as MyTasks), overdue: o.tasks!.overdue, dueToday: t.tasks!.dueToday, newLeads: n.tasks!.newLeads },
        }
      }
      if (seq !== loadSeq.current) return
      if (body.timeZone) setZone(body.timeZone)
      setTasks(body.tasks)
      setNow(new Date())
      setError(null)
      onCount?.(body.tasks.overdue.count + body.tasks.dueToday.count + body.tasks.newLeads.count)
    } catch (err) {
      console.error("my-tasks load failed", err)
      if (seq === loadSeq.current) setError(errorText(err, "Could not load your tasks."))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [limits, onCount])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => everyWhileVisible(() => void load(), POLL_MS), [load])

  // Scroll to the section the dashboard link asked for, once the rows exist.
  useEffect(() => {
    if (!tasks || !focusGroup || scrolled.current) return
    scrolled.current = true
    const el = refs.current[focusGroup]
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    el?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" })
    el?.focus({ preventScroll: true })
  }, [tasks, focusGroup])

  const { profile, accountRole } = useAuth()
  const allowed = (profile?.allowed_pages as string[] | null | undefined) ?? null
  const todoHref = linkOrText("/tasks", accountRole, allowed)

  const more = (g: TaskGroupKey) =>
    setLimits((l) => ({ ...l, [g]: STEPS.find((x) => x > l[g]) ?? STEPS[STEPS.length - 1] }))

  const retry = () => {
    setLoading(true)
    void load()
  }

  if (loading && !tasks) return <TasksSkeleton />

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      {error && <ErrorBanner message={error} onRetry={retry} />}
      {tasks && (
        <>
          <p className="text-[13px] font-medium tabular-nums text-slate-700">
            {summaryLine(tasks.pendingLeads ?? 0, tasks.pendingFollowUps ?? 0)}
          </p>
          <Section
            id="overdue"
            title="Overdue"
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            tone="rose"
            group={tasks.overdue}
            highlighted={highlight === "overdue"}
            setRef={(el) => (refs.current.overdue = el)}
            onFocus={() => setHighlight(null)}
            limit={limits.overdue}
            onMore={() => more("overdue")}
            detail={(r) => lateLabel(r.dueAt, now)}
          />
          <Section
            id="today"
            title="Due today"
            icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
            tone="amber"
            group={tasks.dueToday}
            highlighted={highlight === "today"}
            setRef={(el) => (refs.current.today = el)}
            onFocus={() => setHighlight(null)}
            limit={limits.today}
            onMore={() => more("today")}
            detail={(r) => formatDueTime(r.dueAt, zone)}
          />
          <Section
            id="new"
            title="New for me"
            icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            tone="indigo"
            group={tasks.newLeads}
            highlighted={highlight === "new"}
            setRef={(el) => (refs.current.new = el)}
            onFocus={() => setHighlight(null)}
            limit={limits.new}
            onMore={() => more("new")}
            detail={(r) => [r.source, waitingLabel(r.createdAt, now)].filter(Boolean).join(" · ")}
          />
          {todoHref && (
            <p className="pt-1 text-[12px] text-slate-500">
              <Link href={todoHref} className="underline underline-offset-2 hover:text-slate-700">
                Your manual to-do list
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  )
}

const TONES = {
  rose: { box: "border-rose-200 bg-rose-50", head: "text-rose-700", chip: "bg-white text-rose-700" },
  amber: { box: "border-amber-200 bg-amber-50", head: "text-amber-800", chip: "bg-white text-amber-800" },
  indigo: { box: "border-slate-200 bg-white", head: "text-indigo-700", chip: "bg-indigo-50 text-indigo-700" },
} as const

function Section({
  id, title, icon, tone, group, highlighted, setRef, onFocus, limit, onMore, detail,
}: {
  id: TaskGroupKey
  title: string
  icon: React.ReactNode
  tone: keyof typeof TONES
  group: TaskGroup
  highlighted: boolean
  setRef: (el: HTMLElement | null) => void
  onFocus: () => void
  limit: number
  onMore: () => void
  detail: (row: Row) => string
}) {
  const t = TONES[tone]
  const items = (group.items ?? []) as Row[]
  const more = showingLabel(items.length, group.count)
  return (
    <section
      ref={setRef}
      tabIndex={-1}
      onBlur={onFocus}
      aria-labelledby={`tasks-${id}`}
      className={cn(
        "scroll-mt-20 rounded-xl border p-3 outline-none sm:p-4",
        t.box,
        highlighted && "ring-2 ring-indigo-500",
      )}
    >
      <h2 id={`tasks-${id}`} className={cn("flex items-center gap-2 text-[14px] font-semibold", t.head)}>
        {icon}
        <span>{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", t.chip)}>
          {group.count}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-slate-600">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {EMPTY[id]}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((r) => (
            <TaskRowItem key={`${r.kind}-${r.id}`} row={r} detail={detail(r)} />
          ))}
        </ul>
      )}
      {more && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
          <span className="tabular-nums">{more}</span>
          {limit < STEPS[STEPS.length - 1] ? (
            <button
              type="button"
              onClick={onMore}
              className="h-8 rounded-md px-2 font-semibold text-indigo-700 underline underline-offset-2 hover:bg-white/60"
            >
              Show more
            </button>
          ) : (
            <Link href={fullList(id)} className="font-semibold text-indigo-700 underline underline-offset-2">
              Open the full list
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

/** Where the whole list lives once the tab's own cap is reached. */
function fullList(id: TaskGroupKey): string {
  return id === "new" ? "/leads" : `/follow-ups?due=${id}&mine=1`
}

function TaskRowItem({ row, detail }: { row: Row; detail: string }) {
  const body = (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13px] font-medium text-slate-800">{row.title || "Untitled"}</p>
        <p className="break-words text-[11.5px] text-slate-600">
          {row.leadId ? (row.leadTitle ? `Lead: ${row.leadTitle}` : row.kind === "lead" ? "Lead" : "Open the lead") : "No lead attached"}
        </p>
      </div>
      {detail && <span className="min-w-0 max-w-full break-words text-[12px] font-semibold tabular-nums text-slate-700">{detail}</span>}
    </div>
  )
  const cls = "block rounded-lg border border-slate-200 bg-white px-3 py-2"
  return (
    <li className="min-w-0">
      {row.leadId ? (
        <Link href={`/leads/${row.leadId}`} className={cn(cls, "transition-colors hover:border-indigo-300")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

function TasksSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6" role="status" aria-label="Loading your tasks">
      <Skeleton className="h-4 w-56" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}
