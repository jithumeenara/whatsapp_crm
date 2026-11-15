"use client"

/**
 * The Reports area's own side menu, laid out like Settings: a desktop
 * side menu beside the open report, and on phones a drill-down (the list
 * of reports first, then one report with a back button).
 *
 * The list comes from GET /api/reports/doc: only the reports this person
 * may open, in menu order, each with the exact path to link to and the
 * export formats they may download. Nothing about who sees what is
 * decided here.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { BarChart3, CalendarClock, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { useSidebarCollapse } from "@/components/layout-v2/dashboard-shell-v2"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { readQuery, withQuery, type ReportMenuItem, type ReportQuery } from "./report-query"
import { EXPORT_ROWS, ExportMenu, ExportRow, useReportExport } from "./report-export"
import { reportIcon } from "./report-icons"
import { pendingPathFromClick, replaceTarget } from "./report-nav-target"

const OVERVIEW_PATH = "/reports"
const SCHEDULED_PATH = "/reports/scheduled"

interface MenuState {
  /** null while loading. */
  reports: ReportMenuItem[] | null
  error: string | null
  /** The menu entry for the page that is open, when the menu has one. */
  active: ReportMenuItem | null
  reload: () => void
  /** The report a period / compare / tab change should go to: the one
   *  still opening after a menu click, else the one on screen. */
  targetPath: (pathname: string | null) => string
}

const MenuCtx = createContext<MenuState>({
  reports: null, error: null, active: null, reload: () => {}, targetPath: (p) => replaceTarget(null, p),
})

/** The Reports menu as the side menu loaded it (tabs, exports, titles). */
export function useReportsMenu() {
  return useContext(MenuCtx)
}

function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
}

/** Always explicit, so an opened report never looks like the bare
 *  /reports address that shows the phone's list. */
function explicitLink(path: string, q: ReportQuery): string {
  const p = new URLSearchParams({ period: q.period })
  if (q.period === "custom") {
    p.set("from", q.from)
    p.set("to", q.to)
  }
  p.set("compare", q.compare)
  return `${path}?${p.toString()}`
}

export function ReportsNav({ children }: { children: React.ReactNode }) {
  const pathname = trimSlash(usePathname() ?? OVERVIEW_PATH)
  const sp = useSearchParams()
  const query = readQuery(sp)
  const { collapsed: sidebarCollapsed, toggle: toggleMainSidebar } = useSidebarCollapse()

  const [reports, setReports] = useState<ReportMenuItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sheetOpen, setSheetOpen] = useState(false)
  const loadSeq = useRef(0)
  const paneRef = useRef<HTMLDivElement>(null)

  // The layout stays mounted between reports, so its scroll pane would
  // open the next report where the last one was left. Start at the top.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  // The report being opened by a link click, until it is on screen. A
  // period click in that gap must not send the address back to the old
  // report (report-nav-target.ts explains the jump it caused).
  const pendingPath = useRef<string | null>(null)
  useEffect(() => {
    pendingPath.current = null
  }, [pathname])

  const onLinkClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a) return
    const next = pendingPathFromClick(
      {
        button: e.button, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
        defaultPrevented: e.defaultPrevented, target: a.getAttribute("target") ?? "", href: a.href,
      },
      window.location.origin,
    )
    if (next && next !== pathname) pendingPath.current = next
  }, [pathname])

  const targetPath = useCallback((p: string | null) => replaceTarget(pendingPath.current, p), [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setError(null)
    try {
      const res = await apiFetch("/api/reports/doc", { cache: "no-store" })
      const body = (await res.json()) as { reports?: unknown }
      if (seq !== loadSeq.current) return
      setReports(Array.isArray(body?.reports) ? (body.reports as ReportMenuItem[]) : [])
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[reports] menu failed", err)
      setError(errorText(err, "Could not load the list of reports."))
      setReports((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one load on mount; load() guards with loadSeq
    void load()
  }, [load])

  const active = useMemo(
    () => reports?.find((r) => trimSlash(r.path) === pathname) ?? null,
    [reports, pathname],
  )

  const scheduled = reports?.find((r) => trimSlash(r.path) === SCHEDULED_PATH) ?? null
  const menu = useMemo(() => (reports ?? []).filter((r) => trimSlash(r.path) !== SCHEDULED_PATH), [reports])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (r: ReportMenuItem) => !q || r.title.toLowerCase().includes(q)
    return [
      { key: "overview", label: null as string | null, items: menu.filter((r) => r.group === "overview" && match(r)) },
      { key: "topic", label: "Reports", items: menu.filter((r) => r.group === "topic" && match(r)) },
      { key: "analysis", label: "Analysis", items: menu.filter((r) => r.group === "analysis" && match(r)) },
    ].filter((g) => g.items.length > 0)
  }, [menu, search])

  const exportsAllowed = active?.exports ?? []
  const exportRows = EXPORT_ROWS.filter((r) => exportsAllowed.includes(r.format))
  const { busy, run } = useReportExport(active?.key ?? null, query)

  // Phones: the bare /reports address (or ?list=1 from the back button)
  // shows the list; any report address shows that report.
  // The overview's address as the API gives it ("/reports" until it loads).
  const overviewPath = trimSlash(menu.find((r) => r.group === "overview")?.path ?? OVERVIEW_PATH)
  const showMobileIndex = sp?.get("list") === "1" || (pathname === overviewPath && (sp?.toString() ?? "") === "")
  const backHref = (() => {
    const p = new URLSearchParams(sp?.toString() ?? "")
    p.delete("tab")
    p.set("list", "1")
    return `${overviewPath}?${p.toString()}`
  })()

  const ctx = useMemo<MenuState>(
    () => ({ reports, error, active, reload: () => void load(), targetPath }),
    [reports, error, active, load, targetPath],
  )

  return (
    <MenuCtx.Provider value={ctx}>
      {/* relative: every scroll area here is a positioning context, so an
          absolutely placed child (sr-only labels) scrolls inside it instead
          of stretching the page into blank space below. */}
      <div onClickCapture={onLinkClickCapture} className="relative flex min-h-full flex-col bg-background md:h-full md:min-h-0 md:flex-row">
        {/* ── Side menu (desktop) ── */}
        <aside aria-label="Reports menu" className="relative hidden min-h-0 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex md:w-[248px]">
          <div className="px-4 pb-3 pt-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <BarChart3 className="h-4 w-4" aria-hidden />
              </div>
              <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-tight text-slate-800">Reports</p>
              <button
                type="button"
                onClick={toggleMainSidebar}
                title={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
                aria-label={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronLeft className="h-4 w-4" aria-hidden />}
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                name="reports-menu-filter"
                aria-label="Find a report"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a report…"
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-[12.5px] text-slate-700 placeholder:text-slate-400 transition-colors focus:border-primary/60 focus:bg-white focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-search-cancel-button]:hidden"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-600" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>

          <nav aria-label="Reports" className="sidebar-nav relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-3">
            <MenuBody
              reports={reports}
              error={error}
              groups={groups}
              search={search}
              activePath={pathname}
              query={query}
              onRetry={() => void load()}
            />
          </nav>

          {scheduled && (
            <div className="space-y-0.5 border-t border-slate-100 px-3 py-3">
              <Link
                  href={withQuery(scheduled.path, query)}
                  aria-current={pathname === SCHEDULED_PATH ? "page" : undefined}
                  className={cn(
                    "group mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    pathname === SCHEDULED_PATH ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <span className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                    pathname === SCHEDULED_PATH ? "bg-white" : "bg-slate-100 group-hover:bg-slate-200/70",
                  )}>
                    <CalendarClock className={cn("h-3.5 w-3.5", pathname === SCHEDULED_PATH ? "text-primary" : "text-slate-500")} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{scheduled.title || "Scheduled"}</span>
                </Link>
            </div>
          )}
        </aside>

        {/* ── Phones: the list of reports ── */}
        <div className={cn("md:hidden", !showMobileIndex && "hidden")}>
          <div className="px-4 pb-3 pt-5">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Reports</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">Pick a report to open it.</p>
          </div>
          <div className="space-y-5 px-4 pb-8">
            {reports === null && <MenuSkeleton />}
            {reports !== null && error && <MenuError error={error} onRetry={() => void load()} />}
            {reports !== null && !error && menu.length === 0 && (
              <p className="py-10 text-center text-[13px] text-slate-500">No reports are open to you yet.</p>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                {g.label && <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{g.label}</h2>}
                <ul className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                  {g.items.map((r, i) => {
                    const Icon = reportIcon(r.key)
                    return (
                      <li key={r.key} className={cn(i > 0 && "border-t border-slate-100")}>
                        <Link href={explicitLink(r.path, query)} className="flex min-h-12 w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-50">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 break-words text-[14.5px] font-semibold leading-tight text-slate-800">{r.title}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {scheduled && (
              <Link href={explicitLink(scheduled.path, query)} className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 transition-colors hover:bg-slate-50 active:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <CalendarClock className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-[14.5px] font-semibold text-slate-800">{scheduled.title || "Scheduled"}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
              </Link>
            )}
          </div>
        </div>

        {/* ── The open report ── */}
        <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden", showMobileIndex && "hidden md:flex")}>
          <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-slate-200 bg-white/95 px-2 py-2 backdrop-blur-sm md:hidden">
            <Link
              href={backHref}
              className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl pl-1 pr-2 text-[14px] font-semibold text-slate-600 hover:bg-slate-100 active:bg-slate-100"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
              Reports
            </Link>
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900" title={active?.title}>{active?.title ?? ""}</p>
            {exportRows.length > 0 && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="Export this report"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-100"
              >
                <Download className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>

          <div ref={paneRef} className="relative min-h-0 flex-1 px-4 pb-10 pt-5 md:overflow-y-auto md:px-6 md:pb-12 md:pt-6 lg:px-8 lg:pt-8">
            {/* Export sits top right, level with the period bar on wide screens
                and on its own right-aligned row above it on tablets. Phones use
                the download button in the bar above instead. */}
            <ExportMenu
              formats={exportsAllowed}
              busy={busy}
              onRun={(f) => void run(f)}
              className="hidden md:flex md:justify-end max-lg:mb-3 lg:absolute lg:right-8 lg:top-8 lg:z-10"
            />
            {children}
          </div>
        </div>

        {exportRows.length > 0 && (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="overscroll-contain rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
              <SheetHeader className="pb-0">
                <SheetTitle className="text-[15px] font-semibold">Export</SheetTitle>
                <SheetDescription className="text-[12.5px]">
                  {active?.title ? `${active.title}, for the period on screen.` : "The report on screen, for its period."}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-1 px-2 pb-2">
                {exportRows.map((r) => (
                  <ExportRow key={r.format} format={r.format} label={r.label} busy={busy} onRun={(f) => void run(f)} size="lg" />
                ))}
                <p className="sr-only" role="status" aria-live="polite">{busy ? "Preparing the file…" : ""}</p>
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </MenuCtx.Provider>
  )
}

function MenuSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading reports">
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
    </div>
  )
}

function MenuError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-[12.5px] text-rose-700" role="alert">
      <p>{error}</p>
      <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Retry
      </button>
    </div>
  )
}

function MenuBody({
  reports, error, groups, search, activePath, query, onRetry,
}: {
  reports: ReportMenuItem[] | null
  error: string | null
  groups: Array<{ key: string; label: string | null; items: ReportMenuItem[] }>
  search: string
  activePath: string
  query: ReportQuery
  onRetry: () => void
}) {
  if (reports === null) return <MenuSkeleton />
  if (error) return <MenuError error={error} onRetry={onRetry} />
  if (groups.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-[12.5px] text-slate-500">
        {search.trim() ? <>No report matches “{search.trim()}”</> : "No reports are open to you yet."}
      </p>
    )
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.key}>
          {g.label && (
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{g.label}</p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((r) => {
              const isActive = trimSlash(r.path) === activePath
              const Icon = reportIcon(r.key)
              return (
                <li key={r.key}>
                  <Link
                    href={withQuery(r.path, query)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )}
                  >
                    <span className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                      isActive ? "bg-white" : "bg-slate-100 group-hover:bg-slate-200/70",
                    )}>
                      <Icon className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-slate-500")} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={r.title}>{r.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}
