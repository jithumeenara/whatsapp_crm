"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { AuditEventRow, AuditTime, ActorBadge, OutcomeBadge } from "./audit-event-row"
import { CATEGORY_LABELS, SOURCE_LABELS, actionPhrase, actorName, targetText, type AuditEventView } from "./audit-labels"

interface Detail {
  event: AuditEventView
  same_request: AuditEventView[]
  same_operation: AuditEventView[]
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function Changes({ changes }: { changes: unknown }) {
  const rec = asRecord(changes)
  if (!rec || Object.keys(rec).length === 0) return <p className="text-[12.5px] text-slate-500">No field changes were recorded.</p>
  const rows = Object.entries(rec)
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[320px] text-left text-[12.5px]">
        <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2">Field</th>
            <th scope="col" className="px-3 py-2">Before</th>
            <th scope="col" className="px-3 py-2">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, val]) => {
            const pair = Array.isArray(val) && val.length === 2 ? val : null
            return (
              <tr key={field} className="border-t border-slate-100 align-top">
                <th scope="row" className="px-3 py-2 font-medium text-slate-700">{field.replace(/_/g, " ")}</th>
                <td className="break-words px-3 py-2 text-slate-500">{pair ? show(pair[0]) : "—"}</td>
                <td className="break-words px-3 py-2 text-slate-800">{pair ? show(pair[1]) : show(val)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className={`break-words text-[12.5px] text-slate-700 ${mono ? "font-mono text-[11.5px]" : ""}`}>{value || "—"}</dd>
    </div>
  )
}

const AGENT_KEYS: Array<[string, string]> = [
  ["tool", "Tool"],
  ["model", "Model"],
  ["flow_or_bot_id", "Flow or bot"],
  ["approval_id", "Approval"],
  ["approved_by", "Approved by"],
  ["confidence", "Confidence"],
  ["conversation_id", "Conversation"],
]

function Group({ title, events, timeZone, onOpen }: { title: string; events: AuditEventView[]; timeZone: string; onOpen: (id: string) => void }) {
  if (!events.length) return null
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-semibold text-slate-800">{title} <span className="font-normal text-slate-400">({events.length})</span></h3>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {events.map((e) => <AuditEventRow key={e.id} event={e} timeZone={timeZone} onOpen={onOpen} />)}
      </ul>
    </section>
  )
}

/** The full story of one event. Read-only: there is nothing to edit. */
export function AuditEventDrawer({
  eventId, timeZone, scope, onClose, onOpen,
}: {
  eventId: string | null
  timeZone: string
  scope?: string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  // The answer for one id; loading and error are derived from it, so a
  // newer id never shows an older answer.
  const [result, setResult] = useState<{ id: string; detail?: Detail; error?: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const loadSeq = useRef(0)

  useEffect(() => {
    if (!eventId) return
    const seq = ++loadSeq.current
    const qs = scope === "platform" ? "?scope=platform" : ""
    apiFetch(`/api/audit/events/${encodeURIComponent(eventId)}${qs}`)
      .then((r) => r.json() as Promise<Detail>)
      .then((d) => { if (seq === loadSeq.current) setResult({ id: eventId, detail: d }) })
      .catch((err) => {
        console.error("[audit] event failed to load:", err)
        if (seq === loadSeq.current) setResult({ id: eventId, error: errorText(err, "Could not load this event") })
      })
  }, [eventId, scope, retry])

  const current = result && result.id === eventId ? result : null
  const loading = !!eventId && !current
  const error = current?.error ?? null
  const detail = current?.detail ?? null
  const setRetryFresh = () => { setResult(null); setRetry((n) => n + 1) }

  const e = detail?.event && detail.event.id === eventId ? detail.event : null
  const meta = asRecord(e?.meta)
  const agentRows = meta ? AGENT_KEYS.filter(([k]) => meta[k] !== undefined && meta[k] !== null) : []
  const target = e ? targetText(e) : null

  return (
    <Sheet open={!!eventId} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto overscroll-contain data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Event details</SheetTitle>
          <SheetDescription>{e ? <AuditTime iso={e.occurred_at} timeZone={timeZone} /> : "What happened, who did it and from where"}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {loading && !e && (
            <div role="status" className="flex items-center gap-2 text-[12.5px] text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading…
            </div>
          )}
          {error && (
            <div role="alert" className="space-y-2 rounded-lg bg-rose-50 p-3 text-[12.5px] text-rose-700">
              <p>{error}</p>
              <Button size="sm" variant="outline" onClick={setRetryFresh}>Try again</Button>
            </div>
          )}

          {e && (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ActorBadge type={e.actor_type} />
                  <OutcomeBadge outcome={e.outcome} />
                  <span className="text-[11px] text-slate-400">{CATEGORY_LABELS[e.category] ?? e.category}</span>
                </div>
                <p className="break-words text-[14px] text-slate-800">
                  <span className="font-semibold">{actorName(e)}</span> {actionPhrase(e)}
                </p>
                {target && <p className="break-words text-[12.5px] text-slate-500">{target}</p>}
                {e.reason && <p className="break-words text-[12.5px] text-slate-600">Reason: {e.reason}</p>}
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-slate-800">Changes</h3>
                <Changes changes={e.changes} />
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-slate-800">Context</h3>
                <dl className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                  <Field label="Role at the time" value={e.actor_role} />
                  <Field label="Source" value={SOURCE_LABELS[e.source] ?? e.source} />
                  <Field label="IP address" value={e.ip} mono />
                  <Field label="Device" value={e.user_agent} />
                  <Field label="Request id" value={e.request_id} mono />
                  <Field label="Operation id" value={e.correlation_id} mono />
                  <Field label="Event number" value={`#${e.seq}`} mono />
                  <Field label="Row hash" value={`${e.row_hash.slice(0, 16)}…`} mono />
                </dl>
              </section>

              {(e.actor_type === "agent" || e.on_behalf_of || agentRows.length > 0) && (
                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold text-slate-800">Agent</h3>
                  <dl className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                    {e.actor_type === "agent" && <Field label="Agent" value={e.actor_id?.replace(/_/g, " ")} />}
                    {e.on_behalf_of && <Field label="Acting for" value={e.on_behalf_of_name ?? "A removed member"} />}
                    {agentRows.map(([k, label]) => <Field key={k} label={label} value={show(meta?.[k])} />)}
                  </dl>
                </section>
              )}

              {detail && (
                <>
                  <Group title="Same request" events={detail.same_request} timeZone={timeZone} onOpen={onOpen} />
                  <Group title="Same operation" events={detail.same_operation} timeZone={timeZone} onOpen={onOpen} />
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
