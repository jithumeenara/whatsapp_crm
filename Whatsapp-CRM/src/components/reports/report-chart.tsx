"use client"

/**
 * Draws one ChartBlock. In its own file so the chart library loads after
 * the numbers are on screen (next/dynamic in report-view), not before.
 *
 * Colours come from the theme (--primary, then the --chart-* tokens), so
 * every theme works. A series' previous period is drawn faded (bars) or
 * dashed (lines) and named in the legend. The chart itself is not a tab
 * stop: its text alternative is on the role="img" wrapper in report-view.
 * Animation is off: recharts
 * animates in JavaScript, which the app's reduced-motion CSS can't stop.
 */

import { useSyncExternalStore } from "react"
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import type { ChartBlock, Fmt, Series } from "@/lib/reports/doc/types"
import { formatTick, formatValue } from "./report-format"

const PALETTE = ["var(--primary)", "var(--chart-2)", "var(--chart-7)", "var(--chart-4)", "var(--chart-1)", "var(--chart-5)"]
const color = (i: number) => PALETTE[i % PALETTE.length]
/** The previous period: the same colour, faded. A mixed colour (not an
 *  opacity prop) so the legend swatch is faded too and matches the bars. */
const faded = (i: number, pct = 32) => `color-mix(in oklab, ${color(i)} ${pct}%, white)`

const AXIS_TICK = { fontSize: 11, fill: "#64748b" }
const GRID = "#eef2f7"
const TOOLTIP = {
  contentStyle: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    fontSize: "12px",
    boxShadow: "0 6px 20px rgba(15,23,42,0.08)",
  },
  labelStyle: { color: "#475569", fontWeight: 600, marginBottom: 4 },
  // Text stays dark; the faded "before" colour is for marks, not words.
  itemStyle: { color: "#334155" },
}
const LEGEND = {
  wrapperStyle: { fontSize: 11.5, paddingTop: 6 },
  iconSize: 10,
  // Series order, as the report gave it (recharts sorts by name otherwise).
  itemSorter: null,
  formatter: (value: unknown) => <span style={{ color: "#475569" }}>{String(value)}</span>,
}

type Row = Record<string, string | number | null>

function rows(block: ChartBlock): Row[] {
  const labels = Array.isArray(block.labels) ? block.labels : []
  return labels.map((label, i) => {
    const r: Row = { label: String(label ?? "") }
    ;(block.series ?? []).forEach((s, j) => {
      r[`s${j}`] = numOrNull(s.values?.[i])
      if (Array.isArray(s.previous)) r[`p${j}`] = numOrNull(s.previous[i])
    })
    return r
  })
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

const beforeName = (s: Series) => `${s.name} (before)`

/** Tooltip values in each series' own format. */
function tooltipFormatter(series: Series[]) {
  return (value: unknown, _name: unknown, item: { dataKey?: unknown }) => {
    const key = String(item?.dataKey ?? "")
    const j = Number(key.slice(1))
    const s = series[j]
    const n = typeof value === "number" ? value : Number(value)
    return formatValue(Number.isFinite(n) ? n : null, s?.fmt)
  }
}

/** Wide screens give ranked-bar labels more room; phones keep the bars. */
const WIDE = "(min-width: 640px)"
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  )
}

function shorten(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

export function ReportChart({ block }: { block: ChartBlock }) {
  const wide = useWide()
  const series = Array.isArray(block.series) ? block.series : []
  const data = rows(block)
  const hasPrev = series.some((s) => Array.isArray(s.previous))
  const showLegend = series.length > 1 || hasPrev
  const leftFmt: Fmt | undefined = series.find((s) => s.axis !== "right")?.fmt ?? series[0]?.fmt

  if (block.chart === "funnel") return <Funnel block={block} />

  if (block.chart === "hbar") {
    const longest = data.reduce((m, r) => Math.max(m, String(r.label).length), 0)
    const maxChars = wide ? 30 : 16
    const yWidth = Math.min(wide ? 180 : 100, Math.max(48, Math.min(longest, maxChars) * 6.3 + 8))
    const height = Math.max(140, data.length * (hasPrev ? 34 : 28) + (showLegend ? 56 : 28))
    return (
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 1, height }}>
        <BarChart accessibilityLayer={false} tabIndex={-1} data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatTick(v, leftFmt)} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={yWidth} tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} tickFormatter={(v: string) => shorten(String(v), maxChars)} />
          <Tooltip {...TOOLTIP} formatter={tooltipFormatter(series)} cursor={{ fill: "#f8fafc" }} />
          {showLegend && <Legend {...LEGEND} />}
          {series.map((s, j) => [
            Array.isArray(s.previous) && <Bar key={`p${j}`} dataKey={`p${j}`} name={beforeName(s)} fill={faded(j)} radius={[0, 4, 4, 0]} isAnimationActive={false} />,
            <Bar key={`s${j}`} dataKey={`s${j}`} name={s.name} fill={color(j)} radius={[0, 4, 4, 0]} isAnimationActive={false} />,
          ])}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const height = 240
  const xAxis = <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={(v: string) => shorten(String(v), 12)} />
  const grid = <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
  const tooltip = <Tooltip {...TOOLTIP} formatter={tooltipFormatter(series)} cursor={{ fill: "#f8fafc" }} />
  const legend = showLegend ? <Legend {...LEGEND} /> : null
  const margin = { top: 6, right: 4, left: -12, bottom: 0 }

  if (block.chart === "line") {
    return (
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 1, height }}>
        <LineChart accessibilityLayer={false} tabIndex={-1} data={data} margin={margin}>
          {grid}
          {xAxis}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatTick(v, leftFmt)} />
          {tooltip}
          {legend}
          {series.map((s, j) => [
            Array.isArray(s.previous) && <Line key={`p${j}`} type="monotone" dataKey={`p${j}`} name={beforeName(s)} stroke={faded(j, 60)} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />,
            <Line key={`s${j}`} type="monotone" dataKey={`s${j}`} name={s.name} stroke={color(j)} strokeWidth={2.5} dot={data.length <= 12} isAnimationActive={false} connectNulls />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (block.chart === "barline") {
    const isLine = (s: Series) => s.kind === "line" || (s.kind !== "bar" && s.axis === "right")
    const axisOf = (s: Series) => s.axis ?? (isLine(s) ? "right" : "left")
    const rightFmt = series.find((s) => axisOf(s) === "right")?.fmt
    const hasRight = series.some((s) => axisOf(s) === "right")
    return (
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 1, height }}>
        <ComposedChart accessibilityLayer={false} tabIndex={-1} data={data} margin={{ ...margin, right: hasRight ? -8 : 4 }}>
          {grid}
          {xAxis}
          <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatTick(v, leftFmt)} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatTick(v, rightFmt)} />}
          {tooltip}
          {legend}
          {series.map((s, j) => {
            const axis = axisOf(s)
            if (isLine(s)) {
              return [
                Array.isArray(s.previous) && <Line key={`p${j}`} yAxisId={axis} type="monotone" dataKey={`p${j}`} name={beforeName(s)} stroke={faded(j, 60)} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />,
                <Line key={`s${j}`} yAxisId={axis} type="monotone" dataKey={`s${j}`} name={s.name} stroke={color(j)} strokeWidth={2.5} dot={data.length <= 12} isAnimationActive={false} connectNulls />,
              ]
            }
            return [
              Array.isArray(s.previous) && <Bar key={`p${j}`} yAxisId={axis} dataKey={`p${j}`} name={beforeName(s)} fill={faded(j)} radius={[4, 4, 0, 0]} isAnimationActive={false} />,
              <Bar key={`s${j}`} yAxisId={axis} dataKey={`s${j}`} name={s.name} fill={color(j)} radius={[4, 4, 0, 0]} isAnimationActive={false} />,
            ]
          })}
        </ComposedChart>
      </ResponsiveContainer>
    )
  }

  // "bar" (and anything unknown): columns.
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 1, height }}>
      <BarChart accessibilityLayer={false} tabIndex={-1} data={data} margin={margin}>
        {grid}
        {xAxis}
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatTick(v, leftFmt)} allowDecimals={false} />
        {tooltip}
        {legend}
        {series.map((s, j) => [
          Array.isArray(s.previous) && <Bar key={`p${j}`} dataKey={`p${j}`} name={beforeName(s)} fill={faded(j)} radius={[4, 4, 0, 0]} isAnimationActive={false} />,
          <Bar key={`s${j}`} dataKey={`s${j}`} name={s.name} fill={color(j)} radius={[4, 4, 0, 0]} isAnimationActive={false} />,
        ])}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Stepped stages: each bar as wide as its share of the first stage, with
 *  the count and that share written beside it (so it reads without colour). */
function Funnel({ block }: { block: ChartBlock }) {
  const s = block.series?.[0]
  const labels = Array.isArray(block.labels) ? block.labels : []
  const values = labels.map((_, i) => numOrNull(s?.values?.[i]) ?? 0)
  const first = values[0] ?? 0
  return (
    <ol className="space-y-2">
      {labels.map((label, i) => {
        const v = values[i] ?? 0
        const share = first > 0 ? (v / first) * 100 : 0
        const width = first > 0 ? Math.max(2, Math.min(100, share)) : 0
        const prev = numOrNull(s?.previous?.[i])
        return (
          <li key={`${label}-${i}`} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 break-words text-slate-700">{label}</span>
              <span className="shrink-0 text-right tabular-nums text-slate-600">
                <span className="font-semibold text-slate-800">{formatValue(v, s?.fmt)}</span>
                {i > 0 && first > 0 && <span className="text-slate-500"> · {formatValue(share, { kind: "percent", digits: 0 })} of first</span>}
              </span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-slate-100">
              <div className="h-3 rounded-full bg-primary" style={{ width: `${width}%`, opacity: Math.max(0.45, 1 - i * 0.1) }} />
            </div>
            {prev !== null && <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">Before: {formatValue(prev, s?.fmt)}</p>}
          </li>
        )
      })}
    </ol>
  )
}
