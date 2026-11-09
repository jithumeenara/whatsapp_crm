"use client"

/**
 * The Reports page: the leads report, and for supervisors and above a
 * Spending tab. Which one shows lives in the address (?view=spending), so a
 * reload or a shared link opens the same one. An agent or viewer never sees
 * the tab, and the server refuses them the data regardless.
 */

import { useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { OwnerReport } from "./owner-report"
import { SpendingReportView } from "./spending-report"

export function ReportsShell() {
  const { accountRole } = useAuth()
  const params = useSearchParams()
  const canSeeSpending = accountRole ? hasMinRole(accountRole, "supervisor") : false
  const showSpending = canSeeSpending && params.get("view") === "spending"

  function choose(spending: boolean) {
    // Next syncs the address bar with useSearchParams, so this re-renders.
    const q = new URLSearchParams(window.location.search)
    if (spending) q.set("view", "spending"); else q.delete("view")
    const rest = q.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`)
  }

  return (
    <div>
      {canSeeSpending && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <div role="group" aria-label="Report" className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {([[false, "Leads"], [true, "Spending"]] as const).map(([spending, label]) => (
              <button key={label} type="button" aria-pressed={spending === showSpending}
                onClick={() => choose(spending)}
                className={`min-h-9 rounded-lg px-4 text-[12.5px] font-semibold transition-colors ${spending === showSpending ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {showSpending ? <SpendingReportView /> : <OwnerReport />}
    </div>
  )
}
