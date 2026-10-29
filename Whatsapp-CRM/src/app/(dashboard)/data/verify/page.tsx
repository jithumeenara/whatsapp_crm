"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, Plus } from "lucide-react"
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
}

/** Lists checked by the people on them, from a Google Sheet. */
export default function VerifyListPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    apiFetch("/api/sheet-verifications", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { verifications?: Row[] }) => { if (live) setRows(Array.isArray(d.verifications) ? d.verifications : []) })
      .catch((err) => { console.error("[verify] list failed:", err); if (live) { setRows([]); setError(errorText(err, "Could not load the list")) } })
    return () => { live = false }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F4F6FA]">
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-2.5">
            <Link href="/data" aria-label="Back to Data Store" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className="text-[15px] font-semibold text-slate-900">Check details</h1>
          </div>
          <Link href="/data/verify/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:opacity-90">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New check
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
          Each person on a Google Sheet gets a private link to see their own row, confirm it, or correct what you allow. Corrections go straight back to the same row.
        </p>
        {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
        {rows === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-white" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-2 text-[14px] font-medium text-slate-800">No checks yet</p>
            <p className="mt-1 text-[13px] text-slate-500">Start one for a list in your Google Sheet.</p>
            <Link href="/data/verify/new" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New check
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/data/verify/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-slate-900">{r.name}</span>
                    <span className="block truncate text-[12px] text-slate-500">{r.spreadsheet_name ?? "Google Sheet"} · {r.tab_title}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[12.5px] tabular-nums text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {r.done} done</span>
                  {r.deadline && (
                    <span className="flex items-center gap-1 text-[12px] text-slate-500"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {new Date(r.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  )}
                  {r.status === "closed" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Closed</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
