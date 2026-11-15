"use client"

/**
 * Export the open report as PDF, Excel or PowerPoint, with the period,
 * comparison and tab the screen shows. Used by the side menu (desktop)
 * and the download sheet (phones).
 *
 * apiFetch so a refusal shows the server's words instead of saving an
 * error page as a .pdf (rule 7); one export at a time and the rows locked
 * while it runs, so a double tap makes one file (rule 6).
 */

import { useRef, useState } from "react"
import { ChevronDown, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { apiQuery, type ReportQuery } from "./report-query"

export type ExportFormat = "pdf" | "xlsx" | "pptx"

export const EXPORT_ROWS: Array<{ format: ExportFormat; label: string; fallback: string }> = [
  { format: "pdf", label: "PDF", fallback: "report.pdf" },
  { format: "xlsx", label: "Excel", fallback: "report.xlsx" },
  { format: "pptx", label: "PowerPoint", fallback: "report.pptx" },
]

const ICON: Record<ExportFormat, { color: string; text: string }> = {
  // File-type colours, not brand logos: they say "this is a PDF" at a glance.
  pdf: { color: "#E5252A", text: "PDF" },
  xlsx: { color: "#1D6F42", text: "XLS" },
  pptx: { color: "#D24726", text: "PPT" },
}

/** A document with a folded corner and the file type written on it. */
export function FileTypeIcon({ format, className }: { format: ExportFormat; className?: string }) {
  const { color, text } = ICON[format]
  return (
    <svg viewBox="0 0 24 28" width="20" height="24" className={className} aria-hidden="true" focusable="false">
      <path d="M3 1.5h12.5L21 7v18a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 2 25V3a1.5 1.5 0 0 1 1-1.5Z" fill="#fff" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15.5 1.5V6a1 1 0 0 0 1 1H21" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="0.5" y="13" width="19" height="9" rx="1.5" fill={color} />
      <text x="10" y="20" textAnchor="middle" fontSize="6.6" fontWeight="700" fill="#fff" fontFamily="Inter, Arial, sans-serif" letterSpacing="0.2">
        {text}
      </text>
    </svg>
  )
}

/** The name the server gave, else a plain one. */
function fileName(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)
  if (star?.[1]) {
    try { return decodeURIComponent(star[1]) } catch { /* fall through */ }
  }
  const m = header?.match(/filename="([^"]+)"/)
  return m?.[1] ?? fallback
}

export function useReportExport(reportKey: string | null, query: ReportQuery) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  // A ref as well as state: two taps in the same frame both see busy=null.
  const running = useRef(false)

  async function run(format: ExportFormat) {
    if (!reportKey || running.current) return
    running.current = true
    setBusy(format)
    const row = EXPORT_ROWS.find((r) => r.format === format)
    try {
      const res = await apiFetch(`/api/reports/doc/${encodeURIComponent(reportKey)}?${apiQuery(query, format)}`, { cache: "no-store" })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName(res.headers.get("content-disposition"), row?.fallback ?? "report")
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser a moment to start the download before freeing it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      console.error("[reports] export failed", err)
      toast.error(errorText(err, `Could not prepare the ${row?.label ?? ""} file. Try again.`))
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  return { busy, run }
}

/** One export row: icon, label, and a spinner with "Preparing…" while it runs. */
export function ExportRow({
  format, label, busy, onRun, size = "sm",
}: {
  format: ExportFormat
  label: string
  busy: ExportFormat | null
  onRun: (f: ExportFormat) => void
  size?: "sm" | "lg"
}) {
  const mine = busy === format
  return (
    <button
      type="button"
      onClick={() => onRun(format)}
      disabled={busy !== null}
      aria-busy={mine}
      className={
        size === "lg"
          ? "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14.5px] font-semibold text-slate-800 transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60"
          : "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
      }
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        {mine
          ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />
          : <FileTypeIcon format={format} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{mine ? "Preparing…" : label}</span>
    </button>
  )
}

/**
 * One "Export" button for the top right of the open report. It opens a menu
 * of the formats this report offers, each with its own file-type icon.
 * While a file is being made the button shows a spinner and the rows are
 * locked, so a double tap makes one file (rule 6).
 */
export function ExportMenu({
  formats, busy, onRun, className,
}: {
  formats: ExportFormat[]
  busy: ExportFormat | null
  onRun: (f: ExportFormat) => void
  className?: string
}) {
  const rows = EXPORT_ROWS.filter((r) => formats.includes(r.format))
  if (rows.length === 0) return null
  const working = busy !== null
  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={working}
          aria-busy={working}
          aria-label={working ? "Preparing the file" : "Export this report"}
          className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 data-[popup-open]:bg-slate-50"
        >
          {working
            ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            : <Download className="h-4 w-4" aria-hidden />}
          <span>{working ? "Preparing…" : "Export"}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {rows.map((r) => (
            <DropdownMenuItem
              key={r.format}
              disabled={working}
              onClick={() => onRun(r.format)}
              className="gap-3 px-2.5 py-2 text-[13.5px] font-medium text-slate-700"
            >
              <FileTypeIcon format={r.format} className="size-[22px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="text-[11px] font-normal text-slate-400">.{r.format}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="sr-only" role="status" aria-live="polite">{working ? "Preparing the file…" : ""}</p>
    </div>
  )
}
