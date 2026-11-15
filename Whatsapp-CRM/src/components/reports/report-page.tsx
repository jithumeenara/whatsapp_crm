"use client"

/**
 * One report page: the period bar, the Report | Compare tabs when the
 * report has them, and the ReportDoc from
 * GET /api/reports/doc/[key]?period=…&compare=…&format=json.
 *
 * Only the newest response writes to the screen (loadSeq), so changing
 * the period twice quickly never shows the older answer last.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Lock, RefreshCw } from "lucide-react"
import type { ReportDoc } from "@/lib/reports/doc/types"
import { ApiError, apiFetch, errorText } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PeriodBar } from "./period-bar"
import { CompareControls } from "./compare-controls"
import { ReportView } from "./report-view"
import { useReportsMenu } from "./reports-nav"
import { apiQuery, readQuery, withQuery, type TabKey } from "./report-query"

type State =
  | { status: "loading" }
  | { status: "ready"; doc: ReportDoc }
  | { status: "denied" }
  | { status: "error"; message: string }

export function ReportPage({ reportKey }: { reportKey: string }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const q = readQuery(sp)
  const { reports, targetPath } = useReportsMenu()
  const item = reports?.find((r) => r.key === reportKey) ?? null
  const hasCompare = !!item?.tabs?.includes("compare")
  const tab: TabKey = hasCompare ? q.tab : "report"

  const [state, setState] = useState<State>({ status: "loading" })
  const loadSeq = useRef(0)
  const requestQs = apiQuery({ ...q, tab }, "json")

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setState((s) => (s.status === "ready" ? s : { status: "loading" }))
    try {
      const res = await apiFetch(`/api/reports/doc/${encodeURIComponent(reportKey)}?${requestQs}`, { cache: "no-store" })
      const body = (await res.json()) as { doc?: ReportDoc }
      if (seq !== loadSeq.current) return
      if (!body?.doc) throw new Error("The report came back empty. Try again.")
      setState({ status: "ready", doc: body.doc })
    } catch (err) {
      if (seq !== loadSeq.current) return
      if (err instanceof ApiError && err.status === 403) {
        setState({ status: "denied" })
        return
      }
      console.error("[reports] load failed", err)
      setState({ status: "error", message: errorText(err, "Could not load this report.") })
    }
  }, [reportKey, requestQs])

  // A new period keeps the old numbers on screen, faded, until the new
  // ones arrive. A new report remounts this page (key) and starts blank.
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let alive = true
    setRefreshing(true)
    void load().finally(() => { if (alive) setRefreshing(false) })
    return () => { alive = false }
  }, [load])

  function retry() {
    setRefreshing(true)
    void load().finally(() => setRefreshing(false))
  }

  function setTab(next: TabKey) {
    const p = new URLSearchParams(sp?.toString() ?? "")
    if (next === "report") p.delete("tab")
    else p.set("tab", next)
    p.delete("list")
    const qs = p.toString()
    // targetPath, not pathname: see report-nav-target.ts.
    const path = targetPath(pathname)
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false })
  }

  const body = (() => {
    if (state.status === "loading") return <ReportSkeleton />
    if (state.status === "denied") {
      return (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center" role="alert">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Lock className="h-4 w-4" aria-hidden /></span>
          <p className="text-[14px] font-semibold text-slate-800">You don&apos;t have access to this report.</p>
          <p className="max-w-xs text-[12.5px] text-slate-600">Ask an admin to give you access, or pick another report from the menu.</p>
        </div>
      )
    }
    if (state.status === "error") {
      return (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-8 text-center" role="alert">
          <p className="max-w-md break-words text-[13px] font-medium text-rose-700">{state.message}</p>
          <Button variant="outline" size="sm" onClick={retry} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
            {refreshing ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )
    }
    return (
      <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={refreshing}>
        <ReportView doc={state.doc} />
      </div>
    )
  })()

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4">
      {q.member && reportKey === "agents" && (
        <Link
          href={withQuery(pathname ?? "/reports/agents", q)}
          className="inline-flex h-8 items-center gap-1 rounded-lg pr-2 text-[13px] font-semibold text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Whole team
        </Link>
      )}
      <PeriodBar />

      {hasCompare ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v === "compare" ? "compare" : "report")}>
          <TabsList aria-label="View">
            <TabsTrigger value="report" className="px-3 text-[13px]">Report</TabsTrigger>
            <TabsTrigger value="compare" className="px-3 text-[13px]">Compare</TabsTrigger>
          </TabsList>
          {/* The server builds the comparison when tab=compare (with cmp and items). */}
          <TabsContent value="report" className="mt-2 min-w-0 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-4">{body}</TabsContent>
          <TabsContent value="compare" className="mt-2 min-w-0 space-y-4 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-4">
            {state.status === "ready" && state.doc.compare && <CompareControls spec={state.doc.compare} />}
            {body}
          </TabsContent>
        </Tabs>
      ) : (
        body
      )}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the report">
      <div className="space-y-2">
        <Skeleton className="h-6 w-1/2 max-w-xs" />
        <Skeleton className="h-4 w-3/4 max-w-md" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}
