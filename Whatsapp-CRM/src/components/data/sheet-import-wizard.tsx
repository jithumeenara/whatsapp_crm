"use client"

/**
 * Import a Google Sheet, in two steps:
 *
 *   1 · Choose a spreadsheet — every sheet in the account, newest first,
 *       with search (needs "Google Sheets — browse all"; without it, a
 *       button to allow it, or Google's own file window).
 *   2 · Choose the tab, see its first rows, and say where each column
 *       goes: an existing field, a new field (type guessed from the
 *       values), or nowhere. Then the rows come in.
 *
 * Two places use it:
 *   mode "table" — into an existing table (its ⋯ → Google Sheet panel)
 *   mode "new"   — as a brand-new table (the Data Store page)
 *
 * And two ways to stay linked:
 *   Two-way sync — adds, edits and deletions follow both ways in seconds
 *                  (needs "Google Sheets — two-way sync")
 *   One-way      — new sheet rows come in every 15 minutes
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, ArrowLeftRight, ArrowRight, ArrowDownToLine, Check, Loader2, ShieldCheck, Sparkles, X } from "lucide-react"
import { GoogleSheetsIcon } from "@/components/shared/google-icons"
import { ApiDisabledCard, GoogleSheetList, type ApiDisabled } from "@/components/shared/google-sheet-chooser"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { pickGoogleSpreadsheet } from "@/lib/google/picker-client"

interface Field { field_key: string; label: string; field_type: string }
interface Column { header: string; target: string; type?: string; label?: string; options?: string[] }
interface Preview {
  id: string
  title: string
  tabs: Array<{ title: string; rows: number; columns: number }>
  tab: string
  headers: string[]
  sample: string[][]
  total_rows: number
  fields: Field[]
  columns: Column[]
  can_write?: boolean
}

const TYPES: Array<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "date", label: "Date" },
  { value: "url", label: "Web address" },
  { value: "select", label: "Dropdown" },
]

type SyncMode = "two_way" | "one_way"

export function SheetImportWizard({
  mode = "table",
  tableId,
  tableName,
  canPick,
  defaultSync = "two_way",
  onClose,
  onDone,
}: {
  mode?: "table" | "new"
  /** Required in "table" mode. */
  tableId?: string
  tableName?: string
  /** Google's own file window is available (Sheets + Picker key). */
  canPick: boolean
  defaultSync?: SyncMode
  onClose: () => void
  /** "new" mode passes the created table's id. */
  onDone: (result?: { tableId?: string }) => void
}) {
  const isNew = mode === "new"
  const [step, setStep] = useState<1 | 2>(1)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [previewDisabled, setPreviewDisabled] = useState<ApiDisabled | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [columns, setColumns] = useState<Column[]>([])
  const [sync, setSync] = useState<SyncMode>(defaultSync)
  const [name, setName] = useState("")
  const [importing, setImporting] = useState(false)
  const pickedRef = useRef(false)

  const listEndpoint = isNew ? "/api/google/sheets" : `/api/data-tables/${tableId}/google-sheet/browse`
  const returnTo = isNew ? "/data" : `/data/${tableId}`
  const canWrite = preview?.can_write ?? true
  const twoWayBlocked = sync === "two_way" && !canWrite

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !importing) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, importing])

  // Step 2: tabs, rows and suggested columns.
  const previewSeq = useRef(0)
  const openSheet = useCallback(async (id: string, tab?: string) => {
    const seq = ++previewSeq.current
    setStep(2)
    setLoadingPreview(true)
    setPreviewError("")
    try {
      const q = new URLSearchParams({ spreadsheet: id })
      if (tab) q.set("tab", tab)
      if (pickedRef.current) q.set("picked", "1")
      const url = isNew ? `/api/google/sheets/preview?${q}` : `${listEndpoint}?${q}`
      const d = (await (await apiFetch(url, { cache: "no-store" })).json()) as Preview & { api_disabled?: ApiDisabled }
      if (seq !== previewSeq.current) return
      if (d.api_disabled) {
        setPreviewDisabled(d.api_disabled)
        return
      }
      setPreviewDisabled(null)
      setPreview(d)
      setColumns(d.columns ?? [])
      setName((n) => n || d.tab || d.title || "")
    } catch (err) {
      console.error("[sheet import] preview failed:", err)
      if (seq === previewSeq.current) setPreviewError(errorText(err, "Could not open that sheet."))
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false)
    }
  }, [isNew, listEndpoint])

  async function pickInGoogle() {
    try {
      const picked = await pickGoogleSpreadsheet()
      if (!picked) return
      if (isNew) {
        // Picked files are readable without "browse all": preview as usual.
        pickedRef.current = true
        void openSheet(picked.id)
        return
      }
      // Into an existing table without "browse all": no preview — matched
      // by name, and the rest become new fields.
      setImporting(true)
      const res = await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: sync === "two_way" ? "sync" : "import", spreadsheet_id: picked.id, auto_sync: true }),
      })
      reportTable(await res.json())
    } catch (err) {
      console.error("[sheet import] picker import failed:", err)
      toast.error(errorText(err, "Could not import that sheet."))
    } finally {
      setImporting(false)
    }
  }

  type Stats = { fromSheet?: { created?: number } ; toSheet?: { added?: number } }
  function reportTable(d: { imported?: { imported?: number; error?: string } | null; synced?: { ok?: boolean; error?: string; stats?: Stats } }) {
    if (d.synced) {
      if (!d.synced.ok) toast.error(d.synced.error || "The first sync did not finish.")
      else {
        const inCount = d.synced.stats?.fromSheet?.created ?? 0
        const outCount = d.synced.stats?.toSheet?.added ?? 0
        toast.success(`Two-way sync is on — ${inCount} row${inCount === 1 ? "" : "s"} in from the sheet, ${outCount} record${outCount === 1 ? "" : "s"} added to it.`)
      }
    } else if (d.imported && "error" in d.imported && d.imported.error) {
      toast.error(d.imported.error)
    } else {
      const n = d.imported?.imported ?? 0
      toast.success(n === 0 ? "Sheet linked — no rows to bring in yet." : `${n} row${n === 1 ? "" : "s"} imported into ${tableName}.`)
    }
    onDone()
    onClose()
  }

  const used = useMemo(() => new Set(columns.filter((c) => c.target !== "new" && c.target !== "skip").map((c) => c.target)), [columns])
  const included = columns.filter((c) => c.target !== "skip").length
  const newCount = columns.filter((c) => c.target === "new").length

  const setColumn = (i: number, patch: Partial<Column>) =>
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function runImport() {
    if (!preview || importing) return
    if (included === 0) {
      toast.error("Choose at least one column to import.")
      return
    }
    if (isNew && !name.trim()) {
      toast.error("Give the table a name.")
      return
    }
    setImporting(true)
    try {
      if (isNew) {
        const res = await apiFetch(`/api/data-tables/from-sheet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), spreadsheet_id: preview.id, sheet_title: preview.tab, columns, two_way: sync === "two_way" }),
        })
        const d = (await res.json()) as { table_id: string; two_way: boolean; imported?: number; stats?: Stats }
        const n = d.two_way ? (d.stats?.fromSheet?.created ?? 0) : (d.imported ?? 0)
        toast.success(`${name.trim()} created with ${n} row${n === 1 ? "" : "s"}${d.two_way ? " — two-way sync is on" : ""}.`)
        onDone({ tableId: d.table_id })
        onClose()
        return
      }
      const res = await apiFetch(`/api/data-tables/${tableId}/google-sheet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: sync === "two_way" ? "sync" : "import",
          spreadsheet_id: preview.id,
          sheet_title: preview.tab,
          columns,
          auto_sync: true,
        }),
      })
      reportTable(await res.json())
    } catch (err) {
      console.error("[sheet import] import failed:", err)
      toast.error(errorText(err, "The import did not finish."))
    } finally {
      setImporting(false)
    }
  }

  const connectWrite = `/api/google/connect?services=sheets_sync&return=${encodeURIComponent(returnTo)}`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Import from Google Sheets">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => !importing && onClose()} />
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-4xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
            <GoogleSheetsIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-slate-900">Import from Google Sheets</h2>
            <p className="truncate text-[12px] text-slate-500">
              {isNew ? "As a new table" : <>Into <span className="font-medium text-slate-700">{tableName}</span></>}
            </p>
          </div>
          <ol className="hidden items-center gap-2 text-[12px] font-medium sm:flex">
            {["Choose sheet", "Map columns"].map((label, i) => {
              const n = (i + 1) as 1 | 2
              const done = step > n
              const on = step === n
              return (
                <li key={label} className="flex items-center gap-2">
                  {i > 0 && <span className="h-px w-6 bg-slate-200" />}
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${done ? "bg-emerald-500 text-white" : on ? "bg-[#1A73E8] text-white" : "bg-slate-100 text-slate-500"}`}>
                    {done ? <Check className="h-3.5 w-3.5" /> : n}
                  </span>
                  <span className={on ? "text-slate-900" : "text-slate-400"}>{label}</span>
                </li>
              )
            })}
          </ol>
          <button type="button" onClick={onClose} disabled={importing} aria-label="Close" className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <GoogleSheetList
            endpoint={listEndpoint}
            returnTo={returnTo}
            onChoose={(f) => {
              pickedRef.current = false
              void openSheet(f.id)
            }}
            onPickInGoogle={canPick ? () => void pickInGoogle() : undefined}
            pickBusy={importing}
            alsoSync={sync === "two_way"}
          />
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="flex min-h-0 flex-1 flex-col">
            {loadingPreview && !preview && (
              <div className="flex flex-1 items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            )}
            {previewDisabled && preview === null && (
              <ApiDisabledCard info={previewDisabled} onRetry={() => setStep(1)} />
            )}
            {previewError && (
              <div className="m-6 rounded-xl bg-rose-50 p-4 text-[13px] text-rose-700">
                {previewError}
                <button type="button" onClick={() => setStep(1)} className="ml-2 font-semibold underline">Choose another sheet</button>
              </div>
            )}
            {preview && (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <GoogleSheetsIcon className="h-5 w-5" />
                  <span className="truncate text-[14px] font-semibold text-slate-900">{preview.title}</span>
                  {loadingPreview && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </div>

                {preview.tabs.length > 1 && (
                  <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                    {preview.tabs.map((t) => (
                      <button
                        key={t.title}
                        type="button"
                        disabled={loadingPreview}
                        aria-pressed={t.title === preview.tab}
                        onClick={() => void openSheet(preview.id, t.title)}
                        className={`shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          t.title === preview.tab ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}

                {isNew && (
                  <div className="mt-4">
                    <label htmlFor="sheet-table-name" className="text-[12px] font-semibold text-slate-700">Table name</label>
                    <input
                      id="sheet-table-name"
                      name="table_name"
                      autoComplete="off"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Students, Products, Enquiries…"
                      className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-[#1A73E8] focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                )}

                <p className="mt-4 text-[12.5px] text-slate-600">
                  <span className="font-semibold text-slate-900">{preview.total_rows}</span> row{preview.total_rows === 1 ? "" : "s"} in “{preview.tab}”.
                  {" "}Choose where each column goes{newCount > 0 ? <> — <span className="text-[#1A73E8]">{newCount} new field{newCount === 1 ? "" : "s"}</span> will be added to the table</> : ""}.
                </p>

                {preview.headers.length === 0 ? (
                  <p className="mt-6 rounded-xl bg-amber-50 p-4 text-[13px] text-amber-800">This tab is empty. Choose another tab.</p>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                    <div className="hidden grid-cols-[1fr_auto_1.2fr] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
                      <span>Sheet column</span><span /><span>Goes into</span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {columns.map((c, i) => {
                        const samples = preview.sample.map((r) => r[i]).filter(Boolean).slice(0, 2)
                        const skipped = c.target === "skip"
                        return (
                          <li key={`${c.header}-${i}`} className={`grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_1.2fr] sm:items-center sm:gap-3 ${skipped ? "bg-slate-50/60" : ""}`}>
                            <div className="min-w-0">
                              <p className={`truncate text-[13px] font-medium ${skipped ? "text-slate-400 line-through" : "text-slate-800"}`}>{c.header}</p>
                              <p className="truncate text-[11.5px] text-slate-400">{samples.length ? samples.join(" · ") : "empty"}</p>
                            </div>
                            <ArrowRight className="hidden h-4 w-4 text-slate-300 sm:block" />
                            <div className="flex min-w-0 gap-2">
                              <select
                                value={c.target === "new" ? "new" : c.target}
                                aria-label={`Where “${c.header}” goes`}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setColumn(i, v === "new" ? { target: "new", type: c.type ?? "text", label: c.label ?? c.header } : { target: v })
                                }}
                                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1A73E8]"
                              >
                                <option value="new">＋ New field</option>
                                {preview.fields.length > 0 && (
                                  <optgroup label="Existing fields">
                                    {preview.fields.map((f) => (
                                      <option key={f.field_key} value={f.field_key} disabled={used.has(f.field_key) && c.target !== f.field_key}>
                                        {f.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <option value="skip">Don’t import</option>
                              </select>
                              {c.target === "new" && (
                                <select
                                  value={c.type ?? "text"}
                                  onChange={(e) => setColumn(i, { type: e.target.value })}
                                  aria-label="Field type"
                                  className="h-9 w-32 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[12.5px] outline-none focus:border-[#1A73E8]"
                                >
                                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {preview.sample.length > 0 && (
                  <details className="mt-4 rounded-2xl border border-slate-200">
                    <summary className="cursor-pointer select-none px-4 py-2.5 text-[12.5px] font-medium text-slate-600">Preview the first rows</summary>
                    <div className="overflow-x-auto border-t border-slate-100">
                      <table className="w-full text-left text-[12px]">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>{preview.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {preview.sample.map((r, ri) => (
                            <tr key={ri}>{r.map((v, ci) => <td key={ci} className="max-w-[220px] truncate whitespace-nowrap px-3 py-2">{v}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {/* How it stays linked */}
                <div className="mt-4">
                  <p className="text-[12px] font-semibold text-slate-700">Keep it linked</p>
                  <div role="group" aria-label="Keep it linked" className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {([
                      ["two_way", ArrowLeftRight, "Two-way sync", "Adds, edits and deletions follow both ways — in seconds. Change the sheet or the CRM; the other side updates."],
                      ["one_way", ArrowDownToLine, "One-way import", "New rows in the sheet come in every 15 minutes. Edits and deletions are not copied."],
                    ] as const).map(([key, Icon, title, hint]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={sync === key}
                        onClick={() => setSync(key)}
                        className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${
                          sync === key ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${sync === key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-slate-800">{title}</span>
                          <span className="block text-[11.5px] leading-relaxed text-slate-500">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {sync === "two_way" && canWrite && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-slate-500">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      A “CRM ID” column is added to the sheet to match rows — leave it in place. If many rows vanish from the sheet at once, nothing is deleted here until you confirm.
                    </p>
                  )}
                  {twoWayBlocked && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
                      <span>Two-way sync needs permission to change your sheets.</span>
                      <a href={connectWrite} className="rounded-lg bg-[#1A73E8] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1765CC]">
                        Allow two-way sync
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 border-t border-slate-100 bg-white px-6 py-4">
              <button type="button" onClick={() => setStep(1)} disabled={importing} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <span className="flex-1 truncate text-[12px] text-slate-500">
                {preview ? `${included} of ${columns.length} columns` : ""}
              </span>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={!preview || importing || loadingPreview || included === 0 || twoWayBlocked || (isNew && !name.trim())}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[13.5px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {importing
                  ? "Importing…"
                  : isNew
                    ? "Create table"
                    : `Import ${preview ? Math.min(preview.total_rows, 2000) : ""} rows`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
