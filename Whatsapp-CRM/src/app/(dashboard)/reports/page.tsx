/**
 * Reports: the owner report (docs/plans/reports-plan.md Phase 1), and for
 * supervisors and above a Spending tab. Supervisors and above see the team;
 * anyone else given the page sees only their own work. The API decides
 * which, from the role.
 */

import { Suspense } from "react"
import { ReportsShell } from "@/components/reports/reports-shell"

export default function ReportsPage() {
  // The shell reads the address (?view=), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ReportsShell />
    </Suspense>
  )
}
