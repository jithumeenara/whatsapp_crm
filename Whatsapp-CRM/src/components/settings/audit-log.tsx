"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, categoryOf } from "@/lib/audit/actions"
import { dayEndIso, dayStartIso, zonedDateTime } from "@/lib/audit/zoned"
import { AuditEventList } from "@/components/audit/audit-event-list"
import { AuditEventDrawer } from "@/components/audit/audit-event-drawer"
import { ACTION_PHRASES, CATEGORY_LABELS, OUTCOME_LABELS } from "@/components/audit/audit-labels"

const FALLBACK_TZ = "Asia/Kolkata"
/** Filters kept in the URL as-is; from/to travel as business-zone days. */
const PASS_KEYS = ["actor", "category", "action", "outcome", "target_type", "target_id", "request_id", "correlation_id", "q"] as const
const TEXT_KEYS = ["target_id", "request_id", "q"] as const
type TextKey = (typeof TEXT_KEYS)[number]

interface Summary {
  counts: { events: number; failed_logins: number; denied: number; config_changes: number; exports: number }
  integrity: { head_seq: string | null; head_updated_at: string | null; last_checkpoint_seq: string | null; last_checkpoint_at: string | null }
  timezone: string
}

interface Member { user_id: string; full_name: string; email: string | null }

interface VerifyResult { ok: boolean; rows: number; lastSeq: string; brokenAtSeq: string | null; why: string | null; message?: string | null }

const selectClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b6cf9]"

const WHY_TEXT: Record<string, string> = {
  gap: "an event is missing",
  link: "an event no longer links to the one before it",
  hash: "an event was changed after it was written",
  head: "the newest events were removed",
  archived_start_unverified: "older events were archived and the signed checkpoint they end in could not be checked",
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="truncate text-[11px] text-slate-500">{label}</p>
      <p className="text-[17px] font-semibold tabular-nums text-slate-900">{value === undefined ? "—" : value.toLocaleString("en-IN")}</p>
    </div>
  )
}

export function AuditLog() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { accountRole } = useAuth()
  const isOwner = accountRole === "owner"

  const [timeZone, setTimeZone] = useState<string | null>(null)
  const tz = timeZone ?? FALLBACK_TZ
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [exporting, setExporting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const summarySeq = useRef(0)

  const scope = searchParams.get("scope") === "platform" ? "platform" : null
  const fromDay = searchParams.get("from_day") ?? ""
  const toDay = searchParams.get("to_day") ?? ""
  // The open event is part of the shareable link too.
  const openId = /^\d{1,19}$/.test(searchParams.get("event") ?? "") ? searchParams.get("event") : null

  // ── URL is the source of truth for every filter ──────────────────────
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  // Text boxes are drafts until the typing pauses.
  const [draft, setDraft] = useState<Record<TextKey, string>>(() => ({
    target_id: searchParams.get("target_id") ?? "",
    request_id: searchParams.get("request_id") ?? "",
    q: searchParams.get("q") ?? "",
  }))
  // Only typing writes the URL; back/forward changing it is never undone.
  const latest = useRef({ searchParams, setParams })
  useEffect(() => { latest.current = { searchParams, setParams } }, [searchParams, setParams])
  useEffect(() => {
    const t = setTimeout(() => {
      const { searchParams: sp, setParams: set } = latest.current
      const patch: Record<string, string | null> = {}
      for (const k of TEXT_KEYS) if ((sp.get(k) ?? "") !== draft[k].trim()) patch[k] = draft[k].trim() || null
      if (Object.keys(patch).length) set(patch)
    }, 350)
    return () => clearTimeout(t)
  }, [draft])

  // The API query: business-zone days become ISO with the zone's offset.
  const rangeError = fromDay && toDay && fromDay > toDay ? "The start date is after the end date" : null
  const apiQuery = useMemo(() => {
    const qs = new URLSearchParams()
    if (scope) qs.set("scope", scope)
    if (!rangeError) {
      const from = fromDay ? dayStartIso(fromDay, tz) : null
      const to = toDay ? dayEndIso(toDay, tz) : null
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
    }
    for (const k of PASS_KEYS) {
      const v = searchParams.get(k)
      if (v) qs.set(k, v)
    }
    return qs
  }, [searchParams, fromDay, toDay, tz, scope, rangeError])
  const listQuery = apiQuery.toString()
  const needsZone = !!(fromDay || toDay) && !timeZone

  // ── Summary (also tells us the business time zone) ───────────────────
  const periodQuery = useMemo(() => {
    const qs = new URLSearchParams()
    for (const k of ["scope", "from", "to"]) { const v = apiQuery.get(k); if (v) qs.set(k, v) }
    return qs.toString()
  }, [apiQuery])
  useEffect(() => {
    const seq = ++summarySeq.current
    setSummaryError(null)
    apiFetch(`/api/audit/summary?${periodQuery}`)
      .then((r) => r.json() as Promise<Summary>)
      .then((s) => {
        if (seq !== summarySeq.current) return
        setSummary(s)
        if (s?.timezone) setTimeZone(s.timezone)
      })
      .catch((err) => {
        console.error("[audit] summary failed:", err)
        if (seq === summarySeq.current) setSummaryError(errorText(err, "Could not load the totals"))
      })
  }, [periodQuery])

  useEffect(() => {
    apiFetch("/api/account/members")
      .then((r) => r.json() as Promise<{ members?: Member[] }>)
      .then((b) => setMembers(Array.isArray(b.members) ? b.members : []))
      .catch((err) => console.error("[audit] members failed:", err))
  }, [])

  // ── Export and verify ────────────────────────────────────────────────
  async function runExport(format: "csv" | "json") {
    if (exporting) return
    setExporting(true)
    try {
      const filters: Record<string, string> = {}
      for (const [k, v] of apiQuery.entries()) if (k !== "scope") filters[k] = v
      const res = await apiFetch("/api/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, filters, ...(scope ? { scope } : {}) }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      const rows = res.headers.get("X-Audit-Rows")
      toast.success(rows ? `Exported ${Number(rows).toLocaleString("en-IN")} events` : "Export downloaded")
    } catch (err) {
      console.error("[audit] export failed:", err)
      toast.error(errorText(err, "Could not export the audit log"))
    } finally {
      setExporting(false)
    }
  }

  async function runVerify() {
    if (verifying) return
    setVerifying(true)
    try {
      const res = await apiFetch("/api/audit/verify", { method: "POST" })
      const r = (await res.json()) as VerifyResult
      setVerifyResult(r)
      if (r.ok) toast.success(`All ${r.rows.toLocaleString("en-IN")} events check out`)
      else toast.error("The audit log has a break — see the message above the list")
    } catch (err) {
      console.error("[audit] verify failed:", err)
      toast.error(errorText(err, "Could not check the audit log"))
    } finally {
      setVerifying(false)
    }
  }

  const activeCategory = searchParams.get("category") ?? ""
  const actionOptions = useMemo(
    () => AUDIT_ACTIONS.filter((a) => !activeCategory || categoryOf(a) === activeCategory),
    [activeCategory],
  )
  const setOpenId = useCallback((id: string | null) => setParams({ event: id }), [setParams])
  const hasFilters = PASS_KEYS.some((k) => searchParams.get(k)) || !!fromDay || !!toDay
  const integrity = summary?.integrity

  function clearAll() {
    const patch: Record<string, null> = { from_day: null, to_day: null }
    for (const k of PASS_KEYS) patch[k] = null
    setDraft({ target_id: "", request_id: "", q: "" })
    setParams(patch)
  }

  return (
    <div className="space-y-5">
      {/* ── Header: totals and integrity ── */}
      <section aria-label="Totals for this period" className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Events" value={summary?.counts.events} />
          <Stat label="Failed sign-ins" value={summary?.counts.failed_logins} />
          <Stat label="Refused" value={summary?.counts.denied} />
          <Stat label="Settings changes" value={summary?.counts.config_changes} />
          <Stat label="Exports" value={summary?.counts.exports} />
        </div>
        {summaryError && <p role="alert" className="text-[12px] text-rose-700">{summaryError}</p>}

        {verifyResult && !verifyResult.ok ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              The audit log has a break at event #{verifyResult.brokenAtSeq ?? "?"}: {WHY_TEXT[verifyResult.why ?? ""] ?? "it does not check out"}.
              {verifyResult.message ? <> {verifyResult.message}</> : null}
              Checked {verifyResult.rows.toLocaleString("en-IN")} events. Keep this screen and tell the server owner.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12.5px] text-slate-600">
              {integrity?.head_seq ? <>Chain at event #{Number(integrity.head_seq).toLocaleString("en-IN")}</> : "No events recorded yet"}
              {integrity?.last_checkpoint_at
                ? <> · last signed checkpoint {zonedDateTime(new Date(integrity.last_checkpoint_at), tz)}</>
                : integrity?.head_seq ? " · no signed checkpoint yet" : null}
              {verifyResult?.ok && <> · checked just now ({verifyResult.rows.toLocaleString("en-IN")} events)</>}
            </p>
            {isOwner && !scope && (
              <Button size="sm" variant="outline" disabled={verifying} onClick={() => void runVerify()}>
                {verifying && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {verifying ? "Checking…" : "Verify"}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── Filters ── */}
      <section aria-label="Filters" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          <button
            type="button"
            aria-pressed={!activeCategory}
            onClick={() => setParams({ category: null, action: null })}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${!activeCategory ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            All
          </button>
          {AUDIT_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={activeCategory === c}
              onClick={() => setParams({ category: activeCategory === c ? null : c, action: null })}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${activeCategory === c ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {CATEGORY_LABELS[c] ?? c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="audit-from" className="text-[12px] text-slate-600">From</Label>
            <Input id="audit-from" name="audit-from" autoComplete="off" type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setParams({ from_day: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to" className="text-[12px] text-slate-600">To</Label>
            <Input id="audit-to" name="audit-to" autoComplete="off" type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setParams({ to_day: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-actor" className="text-[12px] text-slate-600">Who</Label>
            <select id="audit-actor" name="audit-actor" className={selectClass} value={searchParams.get("actor") ?? ""} onChange={(e) => setParams({ actor: e.target.value || null })}>
              <option value="">Anyone</option>
              <option value="agent">AI agents</option>
              <option value="api_key">API keys</option>
              <option value="system">System</option>
              <option value="webhook">Webhooks</option>
              <option value="public">Public links</option>
              {members.length > 0 && (
                <optgroup label="Members">
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email || "Member"}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-outcome" className="text-[12px] text-slate-600">Outcome</Label>
            <select id="audit-outcome" name="audit-outcome" className={selectClass} value={searchParams.get("outcome") ?? ""} onChange={(e) => setParams({ outcome: e.target.value || null })}>
              <option value="">Any outcome</option>
              {Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-action" className="text-[12px] text-slate-600">Action</Label>
            <select id="audit-action" name="audit-action" className={selectClass} value={searchParams.get("action") ?? ""} onChange={(e) => setParams({ action: e.target.value || null })}>
              <option value="">Any action</option>
              {actionOptions.map((a) => {
                const p = ACTION_PHRASES[a] ?? a
                return <option key={a} value={a}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              })}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-type" className="text-[12px] text-slate-600">Record type</Label>
            <select id="audit-type" name="audit-type" className={selectClass} value={searchParams.get("target_type") ?? ""} onChange={(e) => setParams({ target_type: e.target.value || null })}>
              <option value="">Any record</option>
              <option value="lead">Lead</option>
              <option value="contact">Contact</option>
              <option value="member">Member</option>
              <option value="broadcast">Broadcast</option>
              <option value="automation">Automation</option>
              <option value="api_key">API key</option>
              <option value="audit_log">Audit log</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-target" className="text-[12px] text-slate-600">Record id</Label>
            <Input id="audit-target" name="audit-target" value={draft.target_id} maxLength={100} autoComplete="off" spellCheck={false} placeholder="e.g. 1042"
              onChange={(e) => setDraft((d) => ({ ...d, target_id: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-request" className="text-[12px] text-slate-600">Request id</Label>
            <Input id="audit-request" name="audit-request" value={draft.request_id} maxLength={80} autoComplete="off" spellCheck={false} placeholder="Copy it from an event’s details…"
              onChange={(e) => setDraft((d) => ({ ...d, request_id: e.target.value }))} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="audit-q" className="text-[12px] text-slate-600">Search names</Label>
          <Input id="audit-q" name="audit-q" type="search" value={draft.q} maxLength={100} autoComplete="off" spellCheck={false} placeholder="A person or record name…"
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} />
        </div>

        {rangeError && <p role="alert" className="text-[12px] text-rose-700">{rangeError}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-[11.5px] text-slate-400">
            {fromDay || toDay ? "Dates are in " : "Last 7 days · dates in "}<span translate="no">{tz}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearAll}>
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear filters
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={exporting || !!rangeError} onClick={() => void runExport("csv")}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
              Export CSV
            </Button>
            <Button size="sm" variant="outline" disabled={exporting || !!rangeError} onClick={() => void runExport("json")}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export JSON
            </Button>
          </div>
        </div>
      </section>

      {/* ── List ── */}
      <section aria-label="Events" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rangeError ? (
          <p className="px-4 py-10 text-center text-[13px] text-slate-500">Fix the dates to see events.</p>
        ) : needsZone ? (
          <div role="status" aria-label="Loading events" className="h-24 animate-pulse bg-slate-50 motion-reduce:animate-none" />
        ) : (
          <AuditEventList query={listQuery} timeZone={tz} onOpen={setOpenId} />
        )}
      </section>

      <p className="text-[11.5px] text-slate-400">
        The audit log can be read and exported but never changed or deleted, by anyone.
      </p>

      <AuditEventDrawer eventId={openId} timeZone={tz} scope={scope ?? undefined} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </div>
  )
}
