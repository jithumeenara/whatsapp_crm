'use client'

import { useState } from 'react'
import {
  PhoneOff, Phone, Calendar, CheckCircle2, MessageSquare,
  TrendingUp, ChevronDown, ChevronRight,
} from 'lucide-react'
import type { LeadActivity } from '@/types'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  created:      <TrendingUp className="size-3.5 text-indigo-500" />,
  stage_change: <Phone className="size-3.5 text-purple-500" />,
  follow_up:    <Calendar className="size-3.5 text-amber-500" />,
  note:         <MessageSquare className="size-3.5 text-slate-400" />,
  call:         <PhoneOff className="size-3.5 text-rose-500" />,
  closed:       <CheckCircle2 className="size-3.5 text-emerald-500" />,
}

const ICON_BG: Record<string, string> = {
  created:      'bg-indigo-50 border-indigo-100',
  stage_change: 'bg-purple-50 border-purple-100',
  follow_up:    'bg-amber-50 border-amber-100',
  note:         'bg-slate-50 border-slate-200',
  call:         'bg-rose-50 border-rose-100',
  closed:       'bg-emerald-50 border-emerald-100',
}

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * "2d ago" rather than "17 Sep, 14:05".
 *
 * A timeline is read for the shape of things — how long the lead sat
 * between the call and the follow-up — and a column of dates makes that
 * arithmetic the reader's job. The exact stamp is on hover, for the one
 * time in twenty somebody needs it.
 */
function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

/** What the lead GET asks for, so the page can tell "all of it" from
 *  "the latest fifty" without a second count query. */
const TIMELINE_LIMIT = 50

// Group activities into phases separated by stage_change events
// Each phase: list of activities until the next stage_change (inclusive)
interface Phase {
  label: string    // the stage_change title or "Initial"
  items: LeadActivity[]
}

function groupIntoPhases(activities: LeadActivity[]): Phase[] {
  if (!activities.length) return []

  const phases: Phase[] = []
  let current: LeadActivity[] = []
  let label = 'Initial'

  for (const act of activities) {
    current.push(act)
    if (act.type === 'stage_change' || act.type === 'closed') {
      phases.push({ label: act.title ?? label, items: current })
      current = []
      label = act.title ?? 'Next'
    }
  }
  if (current.length) {
    phases.push({ label, items: current })
  }
  return phases
}

interface LeadActivityTimelineProps {
  activities: LeadActivity[]
  isClosed?: boolean
  onItemClick?: (dateKey: string) => void
}

export function LeadActivityTimeline({
  activities: received,
  isClosed = false,
  onItemClick,
}: LeadActivityTimelineProps) {
  // The API fetches one more than it shows, so an over-long history can
  // say so instead of silently ending. A timeline that stops without
  // explanation reads as "nothing else happened", which is the one
  // thing it must not imply.
  const truncated = received.length > TIMELINE_LIMIT
  const activities = truncated ? received.slice(0, TIMELINE_LIMIT) : received
  const phases = groupIntoPhases(activities)

  // When closed: previous phases collapsed, last expanded
  // When not closed: all expanded (no grouping UI shown)
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    if (!isClosed || phases.length <= 1) return new Set()
    const s = new Set<number>()
    for (let i = 0; i < phases.length - 1; i++) s.add(i)
    return s
  })

  if (!activities.length) {
    return (
      <p className="text-[13px] text-slate-400 text-center py-4">No activity yet.</p>
    )
  }

  // Flat mode when not closed or single phase
  if (!isClosed || phases.length <= 1) {
    return (
      <>
        <FlatTimeline activities={activities} onItemClick={onItemClick} />
        {truncated && <TruncationNote />}
      </>
    )
  }

  // Grouped mode for closed leads
  return (
    <div className="space-y-2">
      {phases.map((phase, pi) => {
        const isLast = pi === phases.length - 1
        const isCollapsed = collapsed.has(pi)

        return (
          <div key={pi} className={cn(
            "rounded-xl border overflow-hidden transition-all",
            isLast ? "border-emerald-200 shadow-sm" : "border-slate-200"
          )}>
            {/* Phase header */}
            <button
              type="button"
              onClick={() => setCollapsed((prev) => {
                const next = new Set(prev)
                if (next.has(pi)) next.delete(pi)
                else next.add(pi)
                return next
              })}
              className={cn(
                "flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors",
                isLast
                  ? "bg-emerald-50 hover:bg-emerald-100/60"
                  : "bg-slate-50 hover:bg-slate-100"
              )}
            >
              <div className="flex items-center gap-2">
                {isLast
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <div className="h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />}
                <span className={cn(
                  "text-[12px] font-semibold",
                  isLast ? "text-emerald-700" : "text-slate-500"
                )}>
                  {isLast ? "Closed — " : ""}{phase.label}
                </span>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {phase.items.length} event{phase.items.length !== 1 ? "s" : ""}
                </span>
              </div>
              {isCollapsed
                ? <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                : <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
            </button>

            {/* Phase items */}
            {!isCollapsed && (
              <div className="px-4 py-3">
                <FlatTimeline activities={phase.items} compact onItemClick={onItemClick} />
              </div>
            )}
          </div>
        )
      })}
      {truncated && <TruncationNote />}
    </div>
  )
}

function TruncationNote() {
  return (
    <p className="pt-1 text-center text-[11px] text-slate-400">
      Showing the {TIMELINE_LIMIT} most recent. Earlier activity is kept.
    </p>
  )
}

function FlatTimeline({ activities, compact = false, onItemClick }: {
  activities: LeadActivity[]
  compact?: boolean
  onItemClick?: (dateKey: string) => void
}) {
  return (
    <div className="space-y-0">
      {activities.map((act, idx) => (
        <div key={act.id}
          className={cn("flex gap-3", onItemClick && "group cursor-pointer")}
          onClick={onItemClick ? () => onItemClick(new Date(act.created_at).toISOString().slice(0, 10)) : undefined}
          title={onItemClick ? "Click to view messages from this date" : undefined}
        >
          {/* Timeline line */}
          <div className="flex flex-col items-center">
            <div className={cn(
              "flex-shrink-0 mt-1 flex items-center justify-center rounded-full border",
              compact ? "size-5" : "size-6",
              ICON_BG[act.type] ?? 'bg-slate-50 border-slate-200'
            )}>
              {ACTIVITY_ICONS[act.type] ?? <MessageSquare className="size-3 text-slate-400" />}
            </div>
            {idx < activities.length - 1 && (
              <div className="w-px flex-1 bg-slate-200 mt-1" style={{ minHeight: '16px' }} />
            )}
          </div>

          {/* Content */}
          <div className={cn(
            "pb-3 flex-1 min-w-0 rounded-lg transition-colors",
            onItemClick && "group-hover:bg-indigo-50/60 px-2 -mx-2"
          )}>
            <div className="flex items-start justify-between gap-2">
              <p className={cn(
                "font-semibold text-slate-800 leading-tight",
                compact ? "text-[12px]" : "text-[13px]"
              )}>
                {act.title}
              </p>
              <p
                className="shrink-0 text-[11px] text-slate-400"
                title={fmtDT(act.created_at)}
              >
                {relTime(act.created_at)}
              </p>
            </div>
            {act.description && (
              <p className={cn(
                "text-slate-500 mt-0.5",
                compact ? "text-[11px]" : "text-[12px]"
              )}>
                {act.description}
              </p>
            )}
            {/* Who did it. On a shared pool of five agents this is most
                of the question — "Status changed to Follow-up" with
                nobody attached says almost nothing. Falls back to the
                email when a profile has no name yet, and says
                "Automatic" when nothing did it by hand. */}
            <p className="mt-0.5 text-[11px] text-slate-400">
              {act.user
                ? `by ${act.user.profile?.full_name?.trim() || act.user.email}`
                : 'Automatic'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
