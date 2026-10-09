'use client'

/**
 * What a dashboard page shows when something on it crashes.
 *
 * There was no error boundary anywhere in the app, so one component
 * throwing — a field missing on an older record, a response shaped
 * differently than expected — blanked the whole screen, sidebar
 * included, with nothing to press. This keeps the sidebar and the rest
 * of the app, says what happened in plain words, and offers to try
 * again. The details go to the console for whoever is debugging.
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('[page error]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <h2 className="text-[15px] font-semibold text-slate-800">This page could not be shown</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Something on it went wrong. Nothing you saved has been lost. Try again, or go back to the
          dashboard and open it from there.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-slate-400">Reference: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-[13px] font-medium text-white hover:bg-indigo-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-4 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
