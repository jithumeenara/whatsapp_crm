"use client"

/**
 * "Export Excel" for the Spending report: the same period the screen shows.
 * Supervisors and above only: the server refuses anyone else, so it is
 * rendered only for them.
 *
 * apiFetch so a refusal or a server error shows its own words instead of
 * downloading an error page as a .xlsx (rule 7); locked while it runs so a
 * double tap makes one file (rule 6).
 */

import { useState } from "react"
import { FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"

interface Props {
  period: string
  from?: string
  to?: string
  disabled?: boolean
}

/** The name the server gave, else a plain one. */
function fileName(header: string | null): string {
  return header?.match(/filename="([^"]+)"/)?.[1] ?? "spending.xlsx"
}

export function SpendingExcelButton({ period, from, to, disabled }: Props) {
  const [busy, setBusy] = useState(false)

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      const qs = new URLSearchParams({ period })
      if (period === "custom") {
        qs.set("from", from ?? "")
        qs.set("to", to ?? "")
      }
      const res = await apiFetch(`/api/reports/spending/export?${qs.toString()}`, { cache: "no-store" })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName(res.headers.get("content-disposition"))
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser a moment to start the download before freeing it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      console.error("[spending] excel failed", err)
      toast.error(errorText(err, "Could not download the Excel file. Try again."))
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
      aria-label={busy ? "Preparing Excel file" : "Export Excel"}
      className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy
        ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        : <FileSpreadsheet className="h-4 w-4" aria-hidden />}
      <span>{busy ? "Preparing Excel file…" : "Export Excel"}</span>
    </button>
  )
}
