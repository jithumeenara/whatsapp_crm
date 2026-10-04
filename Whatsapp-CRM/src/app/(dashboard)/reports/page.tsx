"use client"

/**
 * Reports — a question about your business's moments, answered from your
 * own data. The workspace itself lives in src/components/reports; this
 * page only decides who may open it.
 *
 * Supervisors and above: a report shows the whole team's numbers, and the
 * API refuses anyone below that whatever this page shows.
 */

import { Lock } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { ReportsWorkspace } from "@/components/reports/reports-workspace"

export default function ReportsPage() {
  const { accountRole } = useAuth()

  // While the role is still loading the workspace starts anyway — the API
  // is what enforces access, so nothing is shown that should not be.
  if (accountRole && !hasMinRole(accountRole, "supervisor")) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
          <Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          <p className="text-[14px] font-semibold text-slate-800">Reports are for supervisors and above</p>
          <p className="mt-1 text-[12.5px] text-slate-500">They show the whole team’s numbers. Ask an administrator if you need access.</p>
        </div>
      </div>
    )
  }

  return <ReportsWorkspace />
}
