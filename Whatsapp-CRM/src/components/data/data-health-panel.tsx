"use client"

/**
 * Data health: what in this table makes answers wrong — one value spelt
 * several ways, a month that disagrees with its date, unreadable dates,
 * empty required cells — with one-click fixes for the first two.
 * See lib/data-store/data-health.ts.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, CalendarX2, CheckCircle2, HeartPulse, Loader2, Wand2 } from "lucide-react"
import { SidePanel } from "./side-panel"

type Issue =
  | {
      kind: "spellings"
      field_key: string
      label: string
      groups: Array<{ keep: string; others: Array<{ value: string; rows: number }> }>
    }
  | {
      kind: "month_mismatch"
      field_key: string
      label: string
      date_label: string
      rows: Array<{ id: string; value: string; should_be: string }>
    }
  | { kind: "unreadable_dates"; field_key: string; label: string; count: number; examples: string[] }
  | { kind: "empty_required"; field_key: string; label: string; count: number }

interface Report {
  rows: number
  truncated: boolean
  issues: Issue[]
}

export function DataHealthPanel({
  tableId,
  tableName,
  onClose,
  onChanged,
}: {
  tableId: string
  tableName: string
  onClose: () => void
  /** Rows were changed: the grid should reload. */
  onChanged: () => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [keep, setKeep] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/data-tables/${tableId}/health`, { cache: "no-store" })
      if (!res.ok) throw new Error()
      setReport(await res.json())
    } catch {
      setFailed(true)
    }
  }, [tableId])

  useEffect(() => {
    void load()
  }, [load])

  async function fix(key: string, body: Record<string, unknown>) {
    setBusy(key)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not fix that")
      setReport(data)
      toast.success(`Updated ${data.changed} row${data.changed === 1 ? "" : "s"}`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fix that")
    } finally {
      setBusy(null)
    }
  }

  const issues = report?.issues ?? []

  return (
    <SidePanel
      title="Data health"
      subtitle={report ? `${report.rows} row${report.rows === 1 ? "" : "s"} checked · ${tableName}` : tableName}
      icon={<HeartPulse className="h-4.5 w-4.5" />}
      onClose={onClose}
    >
      {!report && !failed ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : failed ? (
        <p className="text-[13px] text-slate-500">Could not check this table. Try again in a moment.</p>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="text-[14px] font-semibold text-slate-800">All clear</p>
          <p className="max-w-[300px] text-[12.5px] leading-relaxed text-slate-500">
            No value is spelt two ways, every month matches its date, and every date can be read.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            These make answers wrong: the assistant, and anybody filtering this table, finds one spelling and misses
            the rows with another.
          </p>

          {issues.map((issue, i) => {
            const id = `${issue.kind}-${issue.field_key}-${i}`
            if (issue.kind === "spellings") {
              return (
                <section key={id} className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    &ldquo;{issue.label}&rdquo; is spelt more than one way
                  </h3>
                  <ul className="mt-3 flex flex-col gap-3">
                    {issue.groups.map((g, gi) => {
                      const gkey = `${issue.field_key}-${gi}`
                      const all = [g.keep, ...g.others.map((o) => o.value)]
                      const target = keep[gkey] ?? g.keep
                      return (
                        <li key={gkey} className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[12px] text-slate-600">
                            {all.map((v) => `“${v}”`).join(", ")}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label htmlFor={`keep-${gkey}`} className="text-[12px] text-slate-500">
                              Keep
                            </label>
                            <select
                              id={`keep-${gkey}`}
                              value={target}
                              onChange={(e) => setKeep((k) => ({ ...k, [gkey]: e.target.value }))}
                              className="h-8 max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 text-[12.5px]"
                            >
                              {all.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                            <button
                              onClick={() =>
                                void fix(gkey, { action: "merge", field_key: issue.field_key, from: all.filter((v) => v !== target), to: target })
                              }
                              disabled={busy !== null}
                              className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                            >
                              {busy === gkey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                              Use this for all
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            }
            if (issue.kind === "month_mismatch") {
              return (
                <section key={id} className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    &ldquo;{issue.label}&rdquo; disagrees with &ldquo;{issue.date_label}&rdquo; in {issue.rows.length} row
                    {issue.rows.length === 1 ? "" : "s"}
                  </h3>
                  <ul className="mt-2 flex flex-col gap-1 text-[12px] text-slate-600">
                    {issue.rows.slice(0, 6).map((r) => (
                      <li key={r.id}>
                        &ldquo;{r.value}&rdquo; → <span className="font-medium text-slate-800">&ldquo;{r.should_be}&rdquo;</span>
                      </li>
                    ))}
                    {issue.rows.length > 6 && <li className="text-slate-400">and {issue.rows.length - 6} more</li>}
                  </ul>
                  <button
                    onClick={() => void fix(id, { action: "fix_months", field_key: issue.field_key })}
                    disabled={busy !== null}
                    className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Set {issue.label} from {issue.date_label}
                  </button>
                </section>
              )
            }
            if (issue.kind === "unreadable_dates") {
              return (
                <section key={id} className="rounded-2xl border border-slate-200 p-4">
                  <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                    <CalendarX2 className="h-4 w-4 text-rose-500" />
                    {issue.count} date{issue.count === 1 ? "" : "s"} in &ldquo;{issue.label}&rdquo; cannot be read
                  </h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                    {issue.examples.map((e) => `“${e}”`).join(", ")} — edit these rows and pick the date again. A date
                    nobody can read is never found by a date search.
                  </p>
                </section>
              )
            }
            return (
              <section key={id} className="rounded-2xl border border-slate-200 p-4">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                  <AlertTriangle className="h-4 w-4 text-slate-400" />
                  {issue.count} row{issue.count === 1 ? " has" : "s have"} no &ldquo;{issue.label}&rdquo;
                </h3>
                <p className="mt-1.5 text-[12px] text-slate-500">It is a required field. Filter the table by it to find them.</p>
              </section>
            )
          })}

          {report?.truncated && (
            <p className="text-[11.5px] text-slate-400">Very large table: only its first 5,000 rows were checked.</p>
          )}
        </div>
      )}
    </SidePanel>
  )
}
