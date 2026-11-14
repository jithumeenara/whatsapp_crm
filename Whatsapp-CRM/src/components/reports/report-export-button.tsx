"use client"

/**
 * "Download Excel" / "Download PDF" for the owner report (format). Self-contained: give it the same
 * period the screen shows. Supervisors and above only — the server refuses
 * anyone else, so render it only for them.
 *
 * apiFetch so a refusal or a server error shows its own words instead of
 * downloading an error page as a .xlsx (rule 7); locked while it runs so a
 * double tap makes one file (rule 6).
 */

import { useState } from "react"
import { FileSpreadsheet, FileText, Loader2, Presentation } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"

interface Props {
  period: string
  from?: string
  to?: string
  disabled?: boolean
  /** Excel by default; "pdf" for the printable report in the business's language. */
  format?: "excel" | "pdf" | "pptx"
}

const FORMAT = {
  excel: { path: "/api/reports/export", label: "Download Excel", busy: "Preparing Excel file…", fallback: "report.xlsx", Icon: FileSpreadsheet },
  pdf: { path: "/api/reports/pdf", label: "Download PDF", busy: "Preparing PDF…", fallback: "report.pdf", Icon: FileText },
  pptx: { path: "/api/reports/presentation", label: "Download slides", busy: "Preparing slides…", fallback: "report.pptx", Icon: Presentation },
} as const

/** The name the server gave, else a plain one. */
function fileName(header: string | null, fallback: string): string {
  const m = header?.match(/filename="([^"]+)"/)
  return m?.[1] ?? fallback
}

export function ReportExportButton({ period, from, to, disabled, format = "excel" }: Props) {
  const [busy, setBusy] = useState(false)
  const f = FORMAT[format]

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      const qs = new URLSearchParams({ period })
      if (period === "custom") {
        qs.set("from", from ?? "")
        qs.set("to", to ?? "")
      }
      const res = await apiFetch(`${f.path}?${qs.toString()}`, { cache: "no-store" })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName(res.headers.get("content-disposition"), f.fallback)
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser a moment to start the download before freeing it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      console.error("[reports] export failed", err)
      toast.error(errorText(err, "Could not download the report. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={disabled || busy}
      aria-busy={busy}
      aria-label={busy ? f.busy : f.label}
      className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy
        ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        : <f.Icon className="h-4 w-4" aria-hidden />}
      <span>{busy ? f.busy : f.label}</span>
    </button>
  )
}
