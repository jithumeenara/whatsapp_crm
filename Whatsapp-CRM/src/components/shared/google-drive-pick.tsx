"use client"

/**
 * "Choose from Google Drive" — opens the Google Picker for a spreadsheet.
 *
 * Shown only when Google is connected with a Picker key; otherwise it says
 * where to connect, once, in a line. Picking is also the permission step
 * (drive.file), so a sheet chosen here can stay private.
 */

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Sheet } from "lucide-react"
import { pickGoogleSpreadsheet, type PickedSheet } from "@/lib/google/picker-client"
import { errorText } from "@/lib/api-fetch"

export function GoogleDrivePick({
  onPicked,
  onPickingChange,
  label = "Choose from Google Drive",
}: {
  onPicked: (sheet: PickedSheet) => void
  /** True while Google's window is open — a host dialog uses it to stop
   *  trapping focus and closing on outside clicks. */
  onPickingChange?: (picking: boolean) => void
  label?: string
}) {
  const [state, setState] = useState<"loading" | "ready" | "no-key" | "not-connected">("loading")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/google/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { connected?: boolean; has_api_key?: boolean; services?: Array<{ id: string; state: string }> } | null) => {
        if (cancelled) return
        // Sheets or Drive switched on in the hub, not merely an account signed in.
        const usable = cfg?.services?.some((s) => (s.id === "sheets" || s.id === "drive") && s.state === "connected")
        if (!cfg?.connected || !usable) setState("not-connected")
        else setState(cfg.has_api_key ? "ready" : "no-key")
      })
      .catch(() => { if (!cancelled) setState("not-connected") })
    return () => { cancelled = true }
  }, [])

  async function pick() {
    if (busy) return
    setBusy(true)
    onPickingChange?.(true)
    try {
      const picked = await pickGoogleSpreadsheet()
      if (picked) onPicked(picked)
    } catch (err) {
      toast.error(errorText(err, "Could not open Google Drive"))
    } finally {
      onPickingChange?.(false)
      setBusy(false)
    }
  }

  if (state === "loading") return null
  if (state === "not-connected") {
    return (
      <p className="text-[11.5px] text-slate-400">
        Connect Google Sheets in <a href="/settings?tab=google" className="font-medium text-indigo-600 hover:underline">Settings → Google</a> to choose private sheets.
      </p>
    )
  }
  if (state === "no-key") {
    return (
      <p className="text-[11.5px] text-amber-700">
        Add the Picker API key in <a href="/settings?tab=google" className="font-medium underline">Settings → Google</a> to choose sheets.
      </p>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void pick()}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sheet className="h-3.5 w-3.5 text-emerald-700" />}
      {label}
    </button>
  )
}
