"use client"

import { useEffect, useState } from "react"
import { GOOGLE_DONE_MESSAGE } from "@/lib/google/connect-popup"

/**
 * Where Google's sign-in pop-up ends (src/lib/google/connect-popup.ts):
 * tells the CRM tab that opened it how it went, and closes. Opened on its
 * own (no opener — a blocked pop-up, a bookmarked link), it offers the way
 * back instead.
 */
export default function GoogleDone() {
  const [state, setState] = useState<{ outcome: string; reason: string; standalone: boolean } | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const outcome = q.get("google") ?? "error"
    const reason = q.get("reason") ?? ""
    const opener = window.opener as Window | null
    if (opener && !opener.closed) {
      opener.postMessage({ source: GOOGLE_DONE_MESSAGE, outcome, reason }, window.location.origin)
      window.close()
    }
    // Still open (no opener, or the browser kept it): say so in words.
    const t = setTimeout(() => setState({ outcome, reason, standalone: true }), 300)
    return () => clearTimeout(t)
  }, [])

  const ok = state?.outcome === "connected"
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-[15px] font-semibold text-slate-800">
          {!state ? "Finishing…" : ok ? "Google is connected" : "Google was not connected"}
        </p>
        {state && !ok && state.reason && <p className="mt-2 text-[13px] text-slate-600">{state.reason}</p>}
        {state && (
          <a href="/settings?tab=google" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700">
            Back to the CRM
          </a>
        )}
      </div>
    </main>
  )
}
