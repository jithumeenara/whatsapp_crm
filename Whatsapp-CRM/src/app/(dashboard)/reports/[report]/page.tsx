/**
 * One report from the Reports menu, by its key (/reports/leads → "leads").
 * Whether this person may open it is the API's decision; a refusal shows
 * "You don't have access to this report."
 */

import { Suspense } from "react"
import { ReportPage } from "@/components/reports/report-page"

export default async function ReportByKeyPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params
  return (
    <Suspense fallback={null}>
      <ReportPage key={report} reportKey={report} />
    </Suspense>
  )
}
