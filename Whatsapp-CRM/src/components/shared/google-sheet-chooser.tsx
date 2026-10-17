"use client"

/**
 * The CRM's own Google Sheet chooser — used wherever a sheet is picked
 * (AI Training, Data Store import), in place of Google's file window.
 *
 *  - Every sheet in the account, newest first, searched as you type
 *    (debounced; only the newest answer is shown).
 *  - "Browse all" not granted: one button to allow it, which comes back
 *    to the same page — and, where it works, Google's own window instead.
 *  - A Google API switched off in the Cloud project: the Enable button
 *    for that exact API, and Try again.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowRight, ExternalLink, Loader2, RefreshCw, Search, X } from "lucide-react"
import { GoogleDriveIcon, GoogleSheetsIcon } from "@/components/shared/google-icons"
import { apiFetch, errorText } from "@/lib/api-fetch"

export interface ChosenSheet {
  id: string
  name: string
  url: string
}

interface SheetFile { id: string; name: string; modified_at: string | null; owner: string | null }
export interface ApiDisabled { api: string; enable_url: string }

function ago(iso: string | null): string {
  if (!iso) return ""
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000
  if (d < 1) return "today"
  if (d < 2) return "yesterday"
  if (d < 30) return `${Math.floor(d)} days ago`
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

/** "Turn on <API>" — the one setting only the Google Cloud owner can change. */
export function ApiDisabledCard({ info, onRetry }: { info: ApiDisabled; onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-slate-100">
        {info.api.includes("Drive") ? <GoogleDriveIcon className="h-7 w-7" /> : <GoogleSheetsIcon className="h-8 w-8" />}
      </span>
      <h3 className="mt-5 text-[17px] font-semibold text-slate-900">Turn on the {info.api}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
        It is switched off in your Google Cloud project. This is a one-time setting:
      </p>
      <ol className="mt-4 w-full space-y-2 text-left text-[13px] text-slate-700">
        {[
          <>Open the {info.api} page in Google Cloud (signed in as the project owner).</>,
          <>Click the blue <b>Enable</b> button.</>,
          <>Wait about a minute, then come back and press <b>Try again</b>.</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1A73E8] text-[11px] font-bold text-white">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a
          href={info.enable_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1A73E8] px-5 text-[13.5px] font-semibold text-white shadow-sm hover:bg-[#1765CC]"
        >
          Enable the {info.api} <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    </div>
  )
}

/**
 * Search box and list. `endpoint` answers like /api/google/sheets
 * (files / needs_permission / api_disabled).
 */
export function GoogleSheetList({
  endpoint = "/api/google/sheets",
  returnTo,
  onChoose,
  onPickInGoogle,
  pickBusy,
  alsoSync = false,
}: {
  endpoint?: string
  /** Page to come back to after allowing access. */
  returnTo: string
  onChoose: (file: SheetFile) => void
  /** Google's own file window, offered when browsing is not allowed. */
  onPickInGoogle?: () => void
  pickBusy?: boolean
  /** Ask for two-way sync in the same Google screen (Data Store import). */
  alsoSync?: boolean
}) {
  const [search, setSearch] = useState("")
  const [files, setFiles] = useState<SheetFile[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [canPickHere, setCanPickHere] = useState(true)
  const [disabled, setDisabled] = useState<ApiDisabled | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const seqRef = useRef(0)

  const load = useCallback(async (term: string, page?: string) => {
    const seq = ++seqRef.current
    setLoading(true)
    try {
      const q = new URLSearchParams({ search: term })
      if (page) q.set("page", page)
      const d = (await (await apiFetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${q}`, { cache: "no-store" })).json()) as {
        needs_permission?: boolean
        can_pick?: boolean
        api_disabled?: ApiDisabled
        files?: SheetFile[]
        next?: string | null
      }
      if (seq !== seqRef.current) return
      setNeedsPermission(Boolean(d.needs_permission))
      if (typeof d.can_pick === "boolean") setCanPickHere(d.can_pick)
      setDisabled(d.api_disabled ?? null)
      if (d.files) setFiles((prev) => (page ? [...(prev ?? []), ...d.files!] : d.files!))
      else if (!page) setFiles([])
      setNext(d.next ?? null)
      setError("")
    } catch (err) {
      console.error("[sheet chooser] list failed:", err)
      if (seq === seqRef.current) setError(errorText(err, "Could not list your Google Sheets."))
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    const t = setTimeout(() => void load(search), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, load])

  if (disabled) return <ApiDisabledCard info={disabled} onRetry={() => void load(search)} />

  if (needsPermission) {
    const services = alsoSync ? "sheets_browse,sheets_sync" : "sheets_browse"
    const href = `/api/google/connect?services=${services}&return=${encodeURIComponent(returnTo)}`
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <div className="flex -space-x-2">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-slate-100"><GoogleSheetsIcon className="h-8 w-8" /></span>
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-slate-100"><GoogleDriveIcon className="h-7 w-7" /></span>
        </div>
        <h3 className="mt-5 text-[17px] font-semibold text-slate-900">See all your Google Sheets here</h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-500">
          {alsoSync
            ? "Allow the CRM to list your sheets, and to keep the ones you link to a table in step both ways. It only ever changes a sheet you link here."
            : "Allow the CRM to list and read your sheets once. It can only read — it never changes or deletes anything in Google."}
        </p>
        <a href={href} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[#1A73E8] px-5 text-[13.5px] font-semibold text-white shadow-sm hover:bg-[#1765CC]">
          Allow access to my sheets <ArrowRight className="h-4 w-4" />
        </a>
        {onPickInGoogle && canPickHere && (
          <button type="button" onClick={onPickInGoogle} disabled={pickBusy} className="mt-3 text-[12.5px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50">
            {pickBusy ? "Working…" : "or choose one file in Google’s window"}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your sheets"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-[13.5px] outline-none transition-colors focus:border-[#1A73E8] focus:bg-white"
          />
          {loading && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
      </div>
      <div className="min-h-[320px] flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="mx-2 rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">{error}</p>}
        {!files && !error && (
          <div className="space-y-2 px-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}</div>
        )}
        {files && files.length === 0 && !loading && !error && (
          <p className="py-16 text-center text-[13px] text-slate-400">{search ? `No sheet named like “${search}”.` : "No Google Sheets in this account yet."}</p>
        )}
        <ul className="space-y-1">
          {files?.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onChoose(f)}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
              >
                <GoogleSheetsIcon className="h-8 w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-slate-800">{f.name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {[f.owner === "me" ? "Yours" : f.owner, f.modified_at ? `edited ${ago(f.modified_at)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#1A73E8]" />
              </button>
            </li>
          ))}
        </ul>
        {next && (
          <div className="py-3 text-center">
            <button type="button" disabled={loading} onClick={() => void load(search, next)} className="text-[12.5px] font-medium text-[#1A73E8] hover:underline disabled:opacity-50">
              Show more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** A modal around the list: choose a sheet, get it back. */
export function GoogleSheetChooser({
  title = "Choose a Google Sheet",
  subtitle,
  returnTo,
  onChosen,
  onClose,
  onPickInGoogle,
}: {
  title?: string
  subtitle?: string
  returnTo: string
  onChosen: (sheet: ChosenSheet) => void
  onClose: () => void
  onPickInGoogle?: () => void
}) {
  // Escape closes this, not the dialog it was opened from: caught first
  // (capture) and stopped there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose])

  // On <body>: opened from inside a dialog, a fixed layer would otherwise
  // be positioned (and clipped) by that dialog's transform.
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50"><GoogleSheetsIcon className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="truncate text-[12px] text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <GoogleSheetList
          returnTo={returnTo}
          onPickInGoogle={onPickInGoogle}
          onChoose={(f) => {
            onChosen({ id: f.id, name: f.name, url: `https://docs.google.com/spreadsheets/d/${f.id}/edit` })
            onClose()
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
