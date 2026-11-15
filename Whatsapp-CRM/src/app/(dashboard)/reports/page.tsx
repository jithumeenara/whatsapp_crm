/**
 * The "All report": the overview every other report links back to. The
 * older owner report (ReportsShell) stays in the repo but is no longer
 * shown here; every report now comes back as one ReportDoc.
 */

import { Suspense } from "react"
import { ReportPage } from "@/components/reports/report-page"

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportPage reportKey="all" />
    </Suspense>
  )
}
