"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, Eye, FileSpreadsheet, MoreHorizontal, Plus, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { apiFetch, errorText } from "@/lib/api-fetch"

interface Row {
  id: string
  name: string
  spreadsheet_name: string | null
  tab_title: string
  deadline: string | null
  status: string
  done: number
  opened: number
  /** People the CRM has heard of: sent to, opened or answered. */
  tracked: number
}

function deadlineInfo(deadline: string | null, closed: boolean): { text: string; cls: string } | null {
  if (!deadline) return null
  const d = new Date(deadline)
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
  if (closed) return { text: day, cls: "text-slate-500" }
  const left = d.getTime() - Date.now()
  if (left <= 0) return { text: `Ended ${day}`, cls: "text-slate-500" }
  if (left < 48 * 3_600_000) return { text: `Ends ${day}`, cls: "text-amber-700" }
  return { text: `Until ${day}`, cls: "text-slate-500" }
}

/** Lists checked by the people on them, from a Google Sheet. */
export default function VerifyListPage() {
  const { accountRole } = useAuth()
  const admin = hasMinRole(accountRole ?? "viewer", "admin")
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [askDelete, setAskDelete] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/sheet-verifications", { cache: "no-store" })
      const d = (await res.json()) as { verifications?: Row[] }
      setRows(Array.isArray(d.verifications) ? d.verifications : [])
      setError(null)
    } catch (err) {
      console.error("[verify] list failed:", err)
      setRows((r) => r ?? [])
      setError(errorText(err, "Could not load the list"))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(row: Row) {
    if (deleting) return
    setDeleting(row.id)
    try {
      await apiFetch(`/api/sheet-verifications/${row.id}`, { method: "DELETE" })
      setRows((rs) => (rs ?? []).filter((r) => r.id !== row.id))
      toast.success(`“${row.name}” deleted — its links no longer work. Your sheet is unchanged.`)
    } catch (err) {
      console.error("[verify] delete failed:", err)
      toast.error(errorText(err, "Could not delete"))
    } finally {
      setDeleting(null)
    }
  }

  const list = rows ?? []
  const totals = {
    checks: list.length,
    active: list.filter((r) => r.status !== "closed").length,
    done: list.reduce((n, r) => n + (r.done || 0), 0),
    opened: list.reduce((n, r) => n + (r.opened || 0), 0),
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F4F6FA]">
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href="/data" aria-label="Back to Data Store" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></Link>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-slate-900">Check details</h1>
              <p className="hidden truncate text-[12px] text-slate-500 sm:block">People confirm or correct their own row in your Google Sheet</p>
            </div>
          </div>
          {admin && (
            <Link href="/data/verify/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:opacity-90">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New check
            </Link>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

        {rows === null ? (
          <div className="flex flex-col gap-3">
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardCheck className="h-6 w-6" aria-hidden="true" /></span>
            <p className="mt-3 text-[15px] font-semibold text-slate-900">No checks yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
              Each person on a Google Sheet gets a private link to see their own row, confirm it, or correct what you allow. Corrections go straight back to the same row.
            </p>
            {admin && (
              <Link href="/data/verify/new" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:opacity-90">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New check
              </Link>
            )}
          </div>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["Checks", totals.checks, "text-slate-900"],
                ["Open now", totals.active, "text-slate-900"],
                ["Confirmed", totals.done, "text-emerald-700"],
                ["Opened", totals.opened, "text-amber-700"],
              ] as const).map(([label, n, cls]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <dt className="truncate text-[12px] text-slate-500">{label}</dt>
                  <dd className={`mt-0.5 text-[22px] font-semibold tabular-nums ${cls}`}>{n.toLocaleString()}</dd>
                </div>
              ))}
            </dl>

            <ul className="flex flex-col gap-2.5">
              {list.map((r) => {
                const closed = r.status === "closed"
                const dl = deadlineInfo(r.deadline, closed)
                const pct = r.tracked > 0 ? Math.round((r.done / r.tracked) * 100) : 0
                return (
                  <li key={r.id} className={`group relative rounded-2xl border border-slate-200 bg-white transition-colors hover:border-slate-300 ${deleting === r.id ? "opacity-50" : ""}`}>
                    <Link href={`/data/verify/${r.id}`} className="flex items-start gap-3 rounded-2xl p-4 pe-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${closed ? "bg-slate-100 text-slate-400" : "bg-emerald-50 text-emerald-600"}`}>
                        <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 break-words text-[14.5px] font-semibold text-slate-900" dir="auto">{r.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${closed ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>{closed ? "Closed" : "Open"}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-slate-500" dir="auto">{r.spreadsheet_name ?? "Google Sheet"} · {r.tab_title}</span>

                        <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
                          <span className="flex items-center gap-1 tabular-nums text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {r.done} confirmed</span>
                          {r.opened > 0 && <span className="flex items-center gap-1 tabular-nums text-amber-700"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> {r.opened} opened</span>}
                          {dl && <span className={`flex items-center gap-1 ${dl.cls}`}><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {dl.text}</span>}
                        </span>
                        {r.tracked > 0 && (
                          <span className="mt-2.5 flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% of people reached have answered`}>
                              <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-16 text-end text-[11.5px] tabular-nums text-slate-500">{r.done}/{r.tracked}</span>
                          </span>
                        )}
                      </span>
                      <ChevronRight className="mt-2.5 hidden h-4 w-4 shrink-0 text-slate-300 sm:block" aria-hidden="true" />
                    </Link>

                    {admin && (
                      <div className="absolute end-3 top-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger aria-label={`More for ${r.name}`} disabled={!!deleting} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 data-[popup-open]:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44 border-slate-200 bg-white">
                            <DropdownMenuItem render={<Link href={`/data/verify/${r.id}`} />}>
                              <Eye className="h-4 w-4" /> Open
                            </DropdownMenuItem>
                            <DropdownMenuItem render={<Link href={`/data/verify/${r.id}?tab=settings`} />}>
                              <Settings2 className="h-4 w-4" /> Settings
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setAskDelete(r)}>
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!askDelete}
        title={`Delete “${askDelete?.name ?? ""}”?`}
        description="Every link sent for it stops working. Your Google Sheet, with its answers and corrections, is not touched."
        confirmLabel="Delete"
        variant="destructive"
        onCancel={() => setAskDelete(null)}
        onConfirm={() => { const r = askDelete; setAskDelete(null); if (r) void remove(r) }}
      />
    </div>
  )
}
