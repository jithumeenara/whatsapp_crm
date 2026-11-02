"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { AuditEventRow } from "./audit-event-row"
import type { AuditEventView } from "./audit-labels"

/**
 * A page of audit events for a query string, with "Load more". Only the
 * newest request may write the list (loadSeq), so typing in a filter never
 * shows an older answer last.
 */
export function AuditEventList({
  query, timeZone, onOpen, emptyText = "No events in this period",
}: {
  /** Already-validated search params, without cursor. */
  query: string
  timeZone: string
  onOpen: (id: string) => void
  emptyText?: string
}) {
  const [events, setEvents] = useState<AuditEventView[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async (cursor: string | null) => {
    const seq = ++loadSeq.current
    if (cursor) setLoadingMore(true)
    else { setLoading(true); setError(null) }
    try {
      const qs = new URLSearchParams(query)
      if (cursor) qs.set("cursor", cursor)
      const res = await apiFetch(`/api/audit/events?${qs.toString()}`)
      const body = (await res.json()) as { events?: AuditEventView[]; next_cursor?: string | null }
      if (seq !== loadSeq.current) return
      const page = Array.isArray(body.events) ? body.events : []
      setEvents((prev) => (cursor ? [...prev, ...page] : page))
      setNext(body.next_cursor ?? null)
    } catch (err) {
      console.error("[audit] list failed to load:", err)
      if (seq === loadSeq.current) setError(errorText(err, "Could not load the audit log"))
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [query])

  useEffect(() => { void load(null) }, [load])

  if (loading) {
    return (
      <div role="status" aria-label="Loading events" className="space-y-2 p-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />)}
      </div>
    )
  }
  if (error && events.length === 0) {
    return (
      <div role="alert" className="space-y-2 p-4 text-[12.5px] text-rose-700">
        <p>{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load(null)}>Try again</Button>
      </div>
    )
  }
  if (events.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-slate-500">{emptyText}</p>
  }
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {events.map((e) => <AuditEventRow key={e.id} event={e} timeZone={timeZone} onOpen={onOpen} />)}
      </ul>
      {error && <p role="alert" className="px-4 py-2 text-[12px] text-rose-700">{error}</p>}
      {next && (
        <div className="border-t border-slate-100 p-3 text-center">
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void load(next)}>
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  )
}
