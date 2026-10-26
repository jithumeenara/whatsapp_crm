/**
 * Shown inside the dashboard frame the moment a page is opened, while
 * its server part loads — moving between pages used to show nothing
 * until the whole page was ready.
 */
export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
        ))}
      </div>
      <div className="flex-1 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  )
}
