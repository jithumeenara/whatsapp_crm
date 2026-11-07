/**
 * Reports: the owner report (docs/plans/reports-plan.md Phase 1).
 * Supervisors and above see the team; anyone else given the page sees
 * only their own work. The API decides which, from the role.
 */

import { OwnerReport } from "@/components/reports/owner-report"

export default function ReportsPage() {
  return <OwnerReport />
}
