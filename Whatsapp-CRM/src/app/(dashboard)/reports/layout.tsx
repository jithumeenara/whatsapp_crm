/**
 * The Reports area: its own side menu (from GET /api/reports/doc) beside
 * the open report, like Settings. The main menu collapses on entering
 * (isCompactPage in dashboard-shell-v2).
 */

import { Suspense } from "react"
import { ReportsNav } from "@/components/reports/reports-nav"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  // The menu reads the address (period, compare), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ReportsNav>{children}</ReportsNav>
    </Suspense>
  )
}
