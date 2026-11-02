"use client"

import { zonedDateTime } from "@/lib/audit/zoned"
import {
  ACTOR_BADGE, ACTOR_TYPES, OUTCOME_BADGE, OUTCOME_LABELS, SOURCE_LABELS,
  actionPhrase, actorName, targetText, type AuditEventView,
} from "./audit-labels"

export function AuditTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  const d = new Date(iso)
  return (
    <time dateTime={iso} title={`${d.toISOString().replace("T", " ").slice(0, 19)} UTC`} className="tabular-nums">
      {zonedDateTime(d, timeZone)}
    </time>
  )
}

export function ActorBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ACTOR_BADGE[type] ?? "bg-slate-100 text-slate-600"}`}>
      {ACTOR_TYPES[type] ?? type}
    </span>
  )
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${OUTCOME_BADGE[outcome] ?? "bg-slate-100 text-slate-600"}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  )
}

/** One event as a row you can open. */
export function AuditEventRow({ event, timeZone, onOpen }: { event: AuditEventView; timeZone: string; onOpen: (id: string) => void }) {
  const target = targetText(event)
  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_64px]">
      <button
        type="button"
        onClick={() => onOpen(event.id)}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 sm:flex-row sm:items-start sm:gap-4"
      >
        <span className="shrink-0 text-[11.5px] text-slate-500 sm:w-36 sm:pt-0.5">
          <AuditTime iso={event.occurred_at} timeZone={timeZone} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <ActorBadge type={event.actor_type} />
            <span className="min-w-0 break-words text-[13px] text-slate-800">
              <span className="font-semibold">{actorName(event)}</span> {actionPhrase(event)}
            </span>
          </span>
          {target && <span className="mt-0.5 block break-words text-[12px] text-slate-500">{target}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <OutcomeBadge outcome={event.outcome} />
          <span className="text-[11px] text-slate-400">{SOURCE_LABELS[event.source] ?? event.source}</span>
        </span>
      </button>
    </li>
  )
}
