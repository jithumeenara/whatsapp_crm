"use client"

/**
 * Draws any ReportDoc (src/lib/reports/doc/types.ts): title and headline
 * first, then the blocks in order — figure cards, charts, tables, text,
 * findings — then the notes. One view for every report; the PDF, Excel
 * and PowerPoint builders draw the same doc on the server.
 */

import { useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowRight, CalendarDays, Inbox, Sparkles } from "lucide-react"
import type {
  Block, ChartBlock, Finding, FindingsBlock, KpiBlock, KpiItem, ReportDoc, TableBlock, TableCell, TextBlock, Tone,
} from "@/lib/reports/doc/types"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { compareText, formatRange, safeInternalHref } from "./report-format"
import { readQuery, withQuery, type ReportQuery } from "./report-query"
import { ReportIcon } from "./report-icons"

const ReportChart = dynamic(() => import("./report-chart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full rounded-xl" />,
})

/** A link inside the app keeps the period on screen when it opens a report. */
function linkFor(href: string | undefined, q: ReportQuery): string | null {
  const safe = safeInternalHref(href)
  if (!safe) return null
  // The builders already put the period on their links; only a bare
  // report path gets the one on screen added.
  return safe.startsWith("/reports") && !safe.includes("?") ? withQuery(safe, q) : safe
}

export function ReportView({ doc }: { doc: ReportDoc }) {
  const q = readQuery(useSearchParams())
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : []
  const notes = Array.isArray(doc?.notes) ? doc.notes.filter(Boolean) : []
  const period = doc?.period
  const range = period ? formatRange(period.firstDay, period.lastDay) : ""
  const prev = period?.previous ? formatRange(period.previous.firstDay, period.previous.lastDay) : ""

  return (
    <article className="min-w-0 space-y-5">
      <header className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15" aria-hidden>
            <ReportIcon reportKey={doc?.key} className="h-5 w-5" />
          </span>
          <h1 className="min-w-0 text-balance break-words text-[21px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[23px]">{doc?.title || "Report"}</h1>
        </div>
        {doc?.headline && <p className="mt-2.5 text-pretty text-[15px] leading-snug text-slate-700">{doc.headline}</p>}
        {(range || prev || doc?.scope === "self") && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600">
            {range && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {range}
                {period?.partial && <span className="font-normal text-slate-500">(so far)</span>}
              </span>
            )}
            {prev && <span className="rounded-full bg-slate-100 px-2.5 py-1">compared with {prev}</span>}
            {doc?.scope === "self" && <span className="rounded-full bg-slate-100 px-2.5 py-1">your own work</span>}
          </div>
        )}
      </header>

      {blocks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState icon={<Inbox />} title="Nothing in this period yet." description="Try a longer period, or check again later." />
        </div>
      ) : (
        blocks.map((b, i) => <BlockView key={b?.id ?? `b${i}`} block={b} q={q} />)
      )}

      {notes.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-3 text-[11.5px] leading-relaxed text-slate-500">
          {notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}
        </ul>
      )}
    </article>
  )
}

function BlockView({ block, q }: { block: Block; q: ReportQuery }) {
  switch (block?.kind) {
    case "kpis": return <KpiView block={block} q={q} />
    case "chart": return <ChartView block={block} />
    case "table": return <TableView block={block} q={q} />
    case "text": return <TextView block={block} />
    case "findings": return <FindingsView block={block} q={q} />
    default: return null
  }
}

function Section({ title, note, children, className }: { title?: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-card", className)}>
      {title && <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>}
      <div className={cn(title && "mt-3")}>{children}</div>
      {note && <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">{note}</p>}
    </section>
  )
}

/* ── Figure cards ───────────────────────────────────────────────────── */

const KPI_TONE: Record<Tone, string> = {
  neutral: "bg-white",
  good: "bg-emerald-50/60",
  bad: "bg-rose-50/60",
  warn: "bg-amber-50/60",
  brand: "bg-primary/5",
  money: "bg-indigo-50/60",
}

function KpiView({ block, q }: { block: KpiBlock; q: ReportQuery }) {
  const items = Array.isArray(block.items) ? block.items : []
  if (items.length === 0) return null
  return (
    <section className="min-w-0">
      {block.title && <h2 className="mb-2 text-[14px] font-semibold text-slate-800">{block.title}</h2>}
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {items.map((k, i) => <li key={`${k.label}-${i}`} className="min-w-0"><KpiCard item={k} q={q} /></li>)}
      </ul>
    </section>
  )
}

function KpiCard({ item, q }: { item: KpiItem; q: ReportQuery }) {
  const href = linkFor(item.href, q)
  const body = (
    <>
      <p className="break-words text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
      <p className="mt-1 break-words text-[18px] font-bold leading-tight tabular-nums text-slate-900 sm:text-[22px]">{item.value}</p>
      {item.compare ? <CompareLine c={item.compare} /> : item.sub ? <p className="mt-0.5 break-words text-[11.5px] text-slate-500">{item.sub}</p> : null}
      {href && (
        <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
          Open<ArrowRight className="h-3 w-3" aria-hidden />
        </span>
      )}
    </>
  )
  const cls = cn("block h-full min-w-0 rounded-2xl border border-slate-200 p-3.5", KPI_TONE[item.tone ?? "neutral"] ?? "bg-white")
  if (href) {
    return <Link href={href} className={cn(cls, "transition-colors hover:border-primary/40 hover:bg-primary/5")}>{body}</Link>
  }
  return <div className={cls}>{body}</div>
}

function CompareLine({ c }: { c: NonNullable<KpiItem["compare"]> }) {
  const t = compareText(c)
  const cls = {
    good: "text-emerald-700 font-semibold",
    bad: "text-rose-700 font-semibold",
    same: "text-slate-500",
    small: "text-slate-400",
    none: "text-slate-500",
  }[t.state]
  return (
    <p className={cn("mt-0.5 text-[11.5px] tabular-nums", t.state === "small" && "opacity-80")}>
      <span className="text-slate-500">Before: {t.before}</span>
      {t.change && (
        <>
          <span className="text-slate-400"> · </span>
          <span className={cls}>{t.change}</span>
          {(t.state === "good" || t.state === "bad") && <span className="sr-only">{t.state === "good" ? " (better)" : " (worse)"}</span>}
        </>
      )}
    </p>
  )
}

/* ── Charts ─────────────────────────────────────────────────────────── */

/** A text version for screen readers when the report gave none. */
function autoAlt(block: ChartBlock): string {
  const labels = Array.isArray(block.labels) ? block.labels : []
  const s = block.series?.[0]
  if (!s || labels.length === 0) return `${block.title}: no data.`
  const parts = labels.slice(0, 12).map((l, i) => `${l} ${s.values?.[i] ?? "—"}`)
  return `${block.title}, ${s.name}: ${parts.join(", ")}${labels.length > 12 ? ", and more" : ""}.`
}

function ChartView({ block }: { block: ChartBlock }) {
  const labels = Array.isArray(block.labels) ? block.labels : []
  const series = Array.isArray(block.series) ? block.series : []
  const empty = labels.length === 0 || series.length === 0 || series.every((s) => !Array.isArray(s.values) || s.values.length === 0)
  return (
    <Section title={block.title} note={block.note}>
      {empty ? (
        <p className="py-8 text-center text-[12.5px] text-slate-500">Nothing in this period yet.</p>
      ) : (
        <figure className="min-w-0">
          <div role="img" aria-label={block.alt || autoAlt(block)} className="min-w-0">
            <ReportChart block={block} />
          </div>
        </figure>
      )}
    </Section>
  )
}

/* ── Tables ─────────────────────────────────────────────────────────── */

const CELL_TONE: Record<Tone, string> = {
  neutral: "",
  good: "text-emerald-700 font-medium",
  bad: "text-rose-700 font-medium",
  warn: "text-amber-800 font-medium",
  brand: "text-primary font-medium",
  money: "text-indigo-700 font-medium",
}

const NUMERIC = new Set(["count", "percent", "money", "minutes"])

function TableView({ block, q }: { block: TableBlock; q: ReportQuery }) {
  const [all, setAll] = useState(false)
  const columns = Array.isArray(block.columns) ? block.columns : []
  const rows = Array.isArray(block.rows) ? block.rows : []
  const limit = block.initialRows && block.initialRows > 0 ? block.initialRows : rows.length
  const shown = all ? rows : rows.slice(0, limit)
  const align = (c: number): "left" | "right" | "center" => {
    const col = columns[c]
    if (col?.align) return col.align
    return col?.fmt && NUMERIC.has(col.fmt.kind) ? "right" : "left"
  }
  const alignCls = (c: number) => ({ left: "text-left", right: "text-right tabular-nums", center: "text-center" })[align(c)]

  return (
    <Section title={block.title} note={block.note}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-slate-500">Nothing in this period yet.</p>
      ) : (
        <>
          {/* Wide tables scroll inside this box, never the page. */}
          <div className="-mx-4 max-h-[560px] overflow-auto overscroll-x-contain border-y border-slate-100 sm:mx-0 sm:rounded-xl sm:border">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr>
                  {columns.map((col, c) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        "sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                        alignCls(c),
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, r) => (
                  <tr key={r} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                    {columns.map((_, c) => <Cell key={c} cell={row?.[c]} cls={alignCls(c)} q={q} first={c === 0} />)}
                  </tr>
                ))}
              </tbody>
              {Array.isArray(block.total) && block.total.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold">
                    {columns.map((_, c) => <Cell key={c} cell={block.total?.[c]} cls={alignCls(c)} q={q} first={c === 0} bold />)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {rows.length > limit && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="mt-2 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-primary hover:bg-primary/10"
            >
              {all ? "Show fewer" : `Show all ${rows.length.toLocaleString("en-IN")}`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

function Cell({ cell, cls, q, first, bold }: { cell: TableCell | undefined; cls: string; q: ReportQuery; first: boolean; bold?: boolean }) {
  const text = cell?.text ?? ""
  const href = linkFor(cell?.href, q)
  const Tag = first && !bold ? "th" : "td"
  return (
    <Tag
      scope={Tag === "th" ? "row" : undefined}
      className={cn(
        "px-3 py-2 align-top text-slate-700",
        first ? "max-w-[16rem] break-words text-left font-medium" : "whitespace-nowrap",
        !first && cls,
        cell?.tone && CELL_TONE[cell.tone],
        bold && "font-semibold text-slate-900",
      )}
    >
      {href ? <Link href={href} className="text-primary underline-offset-2 hover:underline">{text || "—"}</Link> : text}
    </Tag>
  )
}

/* ── Text ───────────────────────────────────────────────────────────── */

function TextView({ block }: { block: TextBlock }) {
  const lines = Array.isArray(block.lines) ? block.lines.filter(Boolean) : []
  if (lines.length === 0) return null
  const style = block.style ?? "note"
  if (style === "headline") {
    return (
      <section className="min-w-0">
        {block.title && <h2 className="mb-1 text-[14px] font-semibold text-slate-800">{block.title}</h2>}
        {lines.map((l, i) => <p key={i} className="text-pretty text-[17px] font-semibold leading-snug text-slate-900">{l}</p>)}
      </section>
    )
  }
  if (style === "warning") {
    return (
      <section className="flex min-w-0 gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800" role="note">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1 text-[13px]">
          {block.title && <h2 className="font-semibold">{block.title}</h2>}
          {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
        </div>
      </section>
    )
  }
  if (style === "bullets") {
    return (
      <Section title={block.title}>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700">
          {lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
        </ul>
      </Section>
    )
  }
  return (
    <section className="min-w-0 space-y-1 text-[12.5px] text-slate-500">
      {block.title && <h2 className="text-[13px] font-semibold text-slate-600">{block.title}</h2>}
      {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
    </section>
  )
}

/* ── Findings ───────────────────────────────────────────────────────── */

const SEVERITY: Record<Finding["severity"], { word: string; pill: string; dot: string; edge: string }> = {
  high: { word: "High", pill: "bg-rose-50 text-rose-700", dot: "bg-rose-500", edge: "border-l-rose-400" },
  medium: { word: "Medium", pill: "bg-amber-50 text-amber-800", dot: "bg-amber-500", edge: "border-l-amber-400" },
  low: { word: "Low", pill: "bg-slate-100 text-slate-700", dot: "bg-slate-400", edge: "border-l-slate-300" },
  good: { word: "Good", pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", edge: "border-l-emerald-400" },
}

function FindingsView({ block, q }: { block: FindingsBlock; q: ReportQuery }) {
  const items = Array.isArray(block.items) ? block.items : []
  if (items.length === 0) return null
  return (
    <section className="min-w-0">
      {block.title && <h2 className="mb-2 text-[14px] font-semibold text-slate-800">{block.title}</h2>}
      <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {items.map((f, i) => {
          const sev = SEVERITY[f.severity] ?? SEVERITY.low
          const href = linkFor(f.href, q)
          const actionHref = linkFor(f.action?.href, q)
          return (
            <li key={`${f.title}-${i}`} className={cn("min-w-0 rounded-2xl border border-l-4 border-slate-200 bg-white p-4 shadow-card", sev.edge)}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", sev.pill)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} aria-hidden />
                  {sev.word}
                </span>
                {f.byAi && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-700" title="Written by AI">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    AI<span className="sr-only"> (written by AI)</span>
                  </span>
                )}
              </div>
              <h3 className="mt-2 break-words text-[14px] font-semibold text-slate-800">{f.title}</h3>
              {f.evidence && <p className="mt-1 break-words text-[12.5px] text-slate-600"><span className="font-semibold text-slate-700">Evidence:</span> {f.evidence}</p>}
              {f.suggestion && <p className="mt-1 break-words text-[12.5px] text-slate-600"><span className="font-semibold text-slate-700">Suggestion:</span> {f.suggestion}</p>}
              {(href || actionHref) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {actionHref && (
                    <Link href={actionHref} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/15">
                      {f.action?.label || "Open"}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                  {href && (
                    <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
                      Open report<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
