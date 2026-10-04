'use client'

/**
 * One report's answer: the headline numbers, the insights written from
 * them, a chart and the table behind it.
 *
 * The chart is chosen for the shape of the answer (a line over time, bars
 * for categories, a rate per group for a conversion) and can be switched;
 * "compare" lays the period before beside it. Colour carries meaning only
 * where it should: the change badge is green when things got better —
 * which for missed calls and lost leads means fewer, not more.
 */

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AreaChart as AreaIcon, BarChart3, Lightbulb, LineChart as LineIcon, PieChart as PieIcon, Table2,
  TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import type { ReportDisplay, ReportResult } from '@/lib/reports/engine'
import { formatDuration, formatValue } from '@/lib/reports/insights'
import { shortDay } from '@/lib/reports/period'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

const INDIGO = '#6366f1'
const PREVIOUS = '#cbd5e1'
/** Fixed order, never cycled; an eighth and later fold into "Others". */
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#8b5cf6', '#f43f5e', '#14b8a6']
const OTHERS = '#94a3b8'
const TOOLTIP = {
  contentStyle: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '12px', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' },
  labelStyle: { color: '#475569', fontWeight: 600, marginBottom: 2 },
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Moments where more is worse. */
const MORE_IS_WORSE = new Set(['call.missed', 'lead.lost'])

type Chart = NonNullable<ReportDisplay['chart']>

const pct = (x: number) => `${Math.round(x * 100)}%`

function axisLabel(t: string, bucket?: string): string {
  const [y, m, d] = t.split('-').map(Number)
  if (bucket === 'month') return `${MONTHS[m - 1]} ${String(y).slice(2)}`
  return `${d} ${MONTHS[m - 1]}`
}

function lastDay(toExclusive: string): string {
  return new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

export function chartsFor(r: ReportResult): Chart[] {
  if (r.series) return ['area', 'line', 'bar', 'table']
  if (r.groups) return ['bar', 'pie', 'table']
  if (r.funnel) return r.funnel.groups.length ? ['bar', 'table'] : ['bar']
  if (r.again) return ['bar', 'pie', 'table']
  return ['table']
}

const CHART_META: Record<Chart, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  auto: { label: 'Auto', icon: BarChart3 },
  area: { label: 'Area', icon: AreaIcon },
  line: { label: 'Line', icon: LineIcon },
  bar: { label: 'Bars', icon: BarChart3 },
  pie: { label: 'Donut', icon: PieIcon },
  table: { label: 'Table', icon: Table2 },
}

export function ReportView({
  result,
  insights,
  display,
  onDisplay,
  momentKind,
  presenting = false,
}: {
  result: ReportResult
  insights: string[]
  display: ReportDisplay
  onDisplay: (d: ReportDisplay) => void
  momentKind: string
  presenting?: boolean
}) {
  const options = chartsFor(result)
  const chart: Chart = display.chart && display.chart !== 'auto' && options.includes(display.chart) ? display.chart : options[0]
  const canCompare = (result.shape === 'count' || result.shape === 'sum') && (chart === 'area' || chart === 'line' || chart === 'bar' || chart === 'table')
  const compare = canCompare && display.compare !== false
  const groupsShown = !!(result.groups?.length || result.funnel?.groups.length)
  const top = display.top ?? 10

  const periodText = `${shortDay(result.period.from)} – ${shortDay(lastDay(result.period.toExclusive))}`
  const prevText = `${shortDay(result.period.prevFrom)} – ${shortDay(lastDay(result.period.prevToExclusive))}`

  return (
    <div className={cn('space-y-5', presenting && 'space-y-8')}>
      {/* Title and how to show it */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={cn('font-semibold text-slate-900 [text-wrap:balance]', presenting ? 'text-[28px]' : 'text-[17px]')}>{result.title}</h2>
          <p className={cn('mt-1 text-slate-500', presenting ? 'text-[15px]' : 'text-[12.5px]')}>
            {periodText}
            {compare && <span className="text-slate-400"> · compared with {prevText}</span>}
          </p>
        </div>
        {!presenting && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Chart type">
              {options.map((c) => {
                const Icon = CHART_META[c].icon
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={chart === c}
                    title={CHART_META[c].label}
                    onClick={() => onDisplay({ ...display, chart: c })}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                      chart === c ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{CHART_META[c].label}</span>
                  </button>
                )
              })}
            </div>
            {canCompare && (
              <button
                type="button"
                role="switch"
                aria-checked={compare}
                onClick={() => onDisplay({ ...display, compare: !compare })}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                <span className={cn('relative h-4 w-7 rounded-full transition-colors', compare ? 'bg-indigo-600' : 'bg-slate-300')}>
                  <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', compare ? 'left-3.5' : 'left-0.5')} />
                </span>
                Compare
              </button>
            )}
            {groupsShown && (
              <select
                aria-label="How many to show"
                value={top}
                onChange={(e) => onDisplay({ ...display, top: Number(e.target.value) as 5 | 10 | 25 })}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
                <option value={25}>Top 25</option>
              </select>
            )}
          </div>
        )}
      </div>

      <Headline result={result} momentKind={momentKind} presenting={presenting} compare={compare} />

      {insights.length > 0 && (
        <div className={cn('rounded-xl border border-amber-100 bg-amber-50/60 p-4', presenting && 'p-6')}>
          <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-amber-700">
            <Lightbulb className="h-3.5 w-3.5" /> What stands out
          </p>
          <ul className="space-y-1.5">
            {insights.map((line, i) => (
              <li key={i} className={cn('flex gap-2 text-slate-700', presenting ? 'text-[17px]' : 'text-[13.5px]')}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {!presenting && <p className="mt-2.5 text-[11px] text-amber-700/70">Written automatically from these numbers — no AI.</p>}
        </div>
      )}

      {chart !== 'table' && <ChartArea result={result} chart={chart} compare={compare} top={top} presenting={presenting} />}
      {(chart === 'table' || !presenting) && <DataTable result={result} compare={compare} top={top} />}
    </div>
  )
}

// ── headline numbers ──────────────────────────────────────────────────

function Headline({ result, momentKind, presenting, compare }: { result: ReportResult; momentKind: string; presenting: boolean; compare: boolean }) {
  const unit = result.unit
  const tiles: { label: string; value: string; badge?: React.ReactNode; hint?: string }[] = []

  if (result.shape === 'count' || result.shape === 'sum') {
    tiles.push({ label: 'This period', value: formatValue(result.total, unit), badge: compare ? <Change now={result.total} before={result.previousTotal} worse={MORE_IS_WORSE.has(momentKind)} /> : undefined })
    if (compare) tiles.push({ label: 'Period before', value: formatValue(result.previousTotal, unit) })
    if (result.groups?.length && result.byLabel) {
      tiles.push({ label: `Top ${result.byLabel.toLowerCase()}`, value: result.groups[0].label, hint: `${formatValue(result.groups[0].value, unit)} · ${pct(result.total ? result.groups[0].value / result.total : 0)}` })
    } else if (result.series?.length) {
      const peak = result.series.reduce((b, s) => (s.value > b.value ? s : b), result.series[0])
      tiles.push({ label: result.bucket === 'day' ? 'Busiest day' : result.bucket === 'week' ? 'Busiest week' : 'Busiest month', value: peak.value ? axisLabel(peak.t, result.bucket) : '—', hint: peak.value ? formatValue(peak.value, unit) : undefined })
    }
  } else if (result.funnel) {
    const f = result.funnel
    tiles.push({ label: 'Started', value: f.all.started.toLocaleString('en-IN') })
    tiles.push({ label: `Reached “${f.toLabel}”`, value: f.all.converted.toLocaleString('en-IN') })
    tiles.push({ label: 'Rate', value: pct(f.all.rate) })
    tiles.push({ label: 'Typical time', value: formatDuration(f.all.medianSeconds), hint: 'median' })
  } else if (result.again) {
    tiles.push({ label: 'Customers', value: result.again.customers.toLocaleString('en-IN') })
    tiles.push({ label: 'Came back', value: result.again.returning.toLocaleString('en-IN') })
    tiles.push({ label: 'Rate', value: pct(result.again.rate) })
  }

  return (
    <div className={cn('grid gap-3', tiles.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')}>
      {tiles.map((t) => (
        <div key={t.label} className={cn('min-w-0 rounded-xl border border-slate-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]', presenting && 'p-6')}>
          <p className={cn('truncate text-slate-500', presenting ? 'text-[14px]' : 'text-[12px]')} title={t.label}>{t.label}</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <p className={cn('truncate font-bold tabular-nums text-slate-900', presenting ? 'text-[40px]' : 'text-[24px]')} title={t.value}>{t.value}</p>
            {t.badge}
          </div>
          {t.hint && <p className={cn('mt-0.5 truncate text-slate-400', presenting ? 'text-[13px]' : 'text-[11.5px]')}>{t.hint}</p>}
        </div>
      ))}
    </div>
  )
}

function Change({ now, before, worse }: { now: number; before: number; worse: boolean }) {
  if (!before) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">new</span>
  const change = (now - before) / before
  if (Math.abs(change) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
        <Minus className="h-3 w-3" /> same
      </span>
    )
  }
  const up = change > 0
  const good = worse ? !up : up
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      <Icon className="h-3 w-3" /> {pct(Math.abs(change))}
    </span>
  )
}

// ── chart ─────────────────────────────────────────────────────────────

interface Slice { name: string; value: number; previous?: number; others?: boolean }

function topWithOthers(rows: Slice[], top: number, extra = 0): Slice[] {
  if (rows.length <= top && !extra) return rows
  const head = rows.slice(0, top)
  const rest = rows.slice(top)
  const value = rest.reduce((s, r) => s + r.value, 0) + extra
  const previous = rest.reduce((s, r) => s + (r.previous ?? 0), 0)
  return value > 0 ? [...head, { name: 'Others', value, previous, others: true }] : head
}

function ChartArea({ result, chart, compare, top, presenting }: { result: ReportResult; chart: Chart; compare: boolean; top: number; presenting: boolean }) {
  const unit = result.unit
  const height = presenting ? 420 : 280
  const fmt = (v: unknown) => formatValue(Number(v), unit)

  if (result.series) {
    const data = result.series.map((p, i) => ({ t: axisLabel(p.t, result.bucket), 'This period': p.value, 'Period before': result.previousSeries?.[i]?.value ?? 0 }))
    const axes = (
      <>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={18} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={unit !== null} width={48} />
        <Tooltip {...TOOLTIP} formatter={(v, n) => [fmt(v), String(n)]} />
      </>
    )
    return (
      <div className="rounded-xl border border-slate-100 p-3">
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 1, height }}>
          {chart === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {axes}
              {compare && <Bar dataKey="Period before" fill={PREVIOUS} radius={[4, 4, 0, 0]} maxBarSize={18} />}
              <Bar dataKey="This period" fill={INDIGO} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          ) : chart === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {axes}
              {compare && <Line type="monotone" dataKey="Period before" stroke={PREVIOUS} strokeWidth={2} strokeDasharray="5 4" dot={false} />}
              <Line type="monotone" dataKey="This period" stroke={INDIGO} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="report-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INDIGO} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              {axes}
              {compare && <Area type="monotone" dataKey="Period before" stroke={PREVIOUS} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} />}
              <Area type="monotone" dataKey="This period" stroke={INDIGO} strokeWidth={2.5} fill="url(#report-fill)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          )}
        </ResponsiveContainer>
        {compare && (
          <div className="mt-2 flex gap-4 px-2 text-[11.5px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: INDIGO }} />This period</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: PREVIOUS }} />Period before</span>
          </div>
        )}
      </div>
    )
  }

  if (result.funnel && !result.funnel.groups.length) {
    const f = result.funnel.all
    return (
      <div className="space-y-3 rounded-xl border border-slate-100 p-5">
        <FunnelBar label="Started" value={f.started} width={1} color={INDIGO} />
        <FunnelBar label={`Reached “${result.funnel.toLabel}”`} value={f.converted} width={f.started ? f.converted / f.started : 0} color="#10b981" note={pct(f.rate)} />
      </div>
    )
  }

  let slices: Slice[] = []
  let isRate = false
  if (result.groups) slices = topWithOthers(result.groups.map((g) => ({ name: g.label, value: g.value, previous: g.previous })), top, result.other ?? 0)
  else if (result.funnel) {
    isRate = true
    slices = result.funnel.groups.slice(0, top).map((g) => ({ name: g.label, value: Math.round(g.rate * 1000) / 10 }))
  } else if (result.again) slices = result.again.distribution.map((d) => ({ name: `${d.times} time${d.times === '1' ? '' : 's'}`, value: d.customers }))
  if (!slices.length) return null

  if (chart === 'pie') {
    const total = slices.reduce((s, x) => s + x.value, 0)
    const pie = topWithOthers(slices.filter((s) => !s.others), 7, slices.find((s) => s.others)?.value ?? 0)
    return (
      <div className="grid items-center gap-4 rounded-xl border border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ResponsiveContainer width="100%" height={presenting ? 380 : 260} initialDimension={{ width: 1, height: 240 }}>
          <PieChart>
            <Pie data={pie} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
              {pie.map((s, i) => <Cell key={s.name} fill={s.others ? OTHERS : PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...TOOLTIP} formatter={(v, n) => [`${formatValue(Number(v), unit)} · ${pct(total ? Number(v) / total : 0)}`, String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <ul className="space-y-1.5">
          {pie.map((s, i) => (
            <li key={s.name} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.others ? OTHERS : PALETTE[i % PALETTE.length] }} />
              <span className="min-w-0 flex-1 truncate text-slate-700" title={s.name}>{s.name}</span>
              <span className="tabular-nums text-slate-900">{formatValue(s.value, unit)}</span>
              <span className="w-10 text-right tabular-nums text-slate-400">{pct(total ? s.value / total : 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const vertical = !!result.again
  const rowH = presenting ? 40 : 34
  // Room for the longest name and no more, so the bars keep the width on a phone.
  const labelWidth = Math.min(150, Math.max(56, Math.max(...slices.map((s) => s.name.length)) * 7 + 8))
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <ResponsiveContainer width="100%" height={vertical ? height : Math.max(160, slices.length * rowH + 40)} initialDimension={{ width: 1, height: 200 }}>
        {vertical ? (
          <BarChart data={slices} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11.5, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <Tooltip {...TOOLTIP} formatter={(v) => [Number(v).toLocaleString('en-IN'), 'Customers']} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="value" fill={INDIGO} radius={[6, 6, 0, 0]} maxBarSize={56} />
          </BarChart>
        ) : (
          <BarChart data={slices} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} domain={isRate ? [0, 100] : undefined} unit={isRate ? '%' : undefined} />
            <YAxis type="category" dataKey="name" width={labelWidth} tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} formatter={(v, n) => [isRate ? `${v}%` : fmt(v), n === 'previous' ? 'Period before' : isRate ? 'Rate' : 'This period']} cursor={{ fill: '#f8fafc' }} />
            {compare && !isRate && <Bar dataKey="previous" fill={PREVIOUS} radius={[0, 4, 4, 0]} maxBarSize={14} />}
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={compare ? 14 : 22}>
              {slices.map((s) => <Cell key={s.name} fill={s.others ? OTHERS : INDIGO} />)}
              <LabelList dataKey="value" position="right" offset={8} fontSize={11.5} fill="#475569" formatter={(v: unknown) => (isRate ? `${v}%` : fmt(v))} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function FunnelBar({ label, value, width, color, note }: { label: string; value: number; width: number; color: string; note?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900">
          {value.toLocaleString('en-IN')}
          {note && <span className="ml-2 text-slate-400">{note}</span>}
        </span>
      </div>
      <div className="h-8 overflow-hidden rounded-lg bg-slate-100">
        <div className="h-full rounded-lg transition-[width] duration-500" style={{ width: `${Math.max(width * 100, value ? 2 : 0)}%`, background: color }} />
      </div>
    </div>
  )
}

// ── table ─────────────────────────────────────────────────────────────

function DataTable({ result, compare, top }: { result: ReportResult; compare: boolean; top: number }) {
  const unit = result.unit
  const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500'
  const td = 'px-4 py-2.5 text-[13px] text-slate-700 tabular-nums'
  const wrap = (body: React.ReactNode) => (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full min-w-[440px]">{body}</table>
    </div>
  )

  if (result.groups?.length) {
    const rows = result.groups.slice(0, top)
    const rest = result.groups.slice(top).reduce((s, g) => s + g.value, 0) + (result.other ?? 0)
    return wrap(
      <>
        <thead className="bg-slate-50"><tr>
          <th className={th}>{result.byLabel}</th>
          <th className={th}>This period</th>
          <th className={th}>Share</th>
          {compare && <th className={th}>Period before</th>}
          {compare && <th className={th}>Change</th>}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((g) => (
            <tr key={g.key} className="hover:bg-slate-50/60">
              <td className={cn(td, 'max-w-[280px] truncate font-medium text-slate-800')} title={g.label}>{g.label}</td>
              <td className={td}>{formatValue(g.value, unit)}</td>
              <td className={cn(td, 'text-slate-500')}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-400" style={{ width: pct(result.total ? g.value / result.total : 0) }} /></span>
                  {pct(result.total ? g.value / result.total : 0)}
                </span>
              </td>
              {compare && <td className={cn(td, 'text-slate-500')}>{formatValue(g.previous, unit)}</td>}
              {compare && <td className={td}>{g.previous ? `${g.value >= g.previous ? '+' : '−'}${pct(Math.abs(g.value - g.previous) / g.previous)}` : '—'}</td>}
            </tr>
          ))}
          {rest > 0 && (
            <tr><td className={cn(td, 'text-slate-500')}>Everything else</td><td className={td}>{formatValue(rest, unit)}</td><td className={cn(td, 'text-slate-400')}>{pct(result.total ? rest / result.total : 0)}</td>{compare && <td />}{compare && <td />}</tr>
          )}
          <tr className="bg-slate-50/60 font-semibold">
            <td className={cn(td, 'font-semibold text-slate-900')}>Total</td>
            <td className={cn(td, 'font-semibold text-slate-900')}>{formatValue(result.total, unit)}</td>
            <td className={td} />
            {compare && <td className={cn(td, 'text-slate-500')}>{formatValue(result.previousTotal, unit)}</td>}
            {compare && <td className={td}>{result.previousTotal ? `${result.total >= result.previousTotal ? '+' : '−'}${pct(Math.abs(result.total - result.previousTotal) / result.previousTotal)}` : '—'}</td>}
          </tr>
        </tbody>
      </>,
    )
  }

  if (result.funnel?.groups.length) {
    return wrap(
      <>
        <thead className="bg-slate-50"><tr>
          <th className={th}>{result.byLabel}</th><th className={th}>Started</th><th className={th}>Reached</th><th className={th}>Rate</th><th className={th}>Typical time</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {result.funnel.groups.slice(0, top).map((g) => (
            <tr key={g.key} className="hover:bg-slate-50/60">
              <td className={cn(td, 'max-w-[280px] truncate font-medium text-slate-800')} title={g.label}>{g.label}</td>
              <td className={td}>{g.started.toLocaleString('en-IN')}</td>
              <td className={td}>{g.converted.toLocaleString('en-IN')}</td>
              <td className={td}>{pct(g.rate)}</td>
              <td className={cn(td, 'text-slate-500')}>{formatDuration(g.medianSeconds)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50/60">
            <td className={cn(td, 'font-semibold text-slate-900')}>All</td>
            <td className={cn(td, 'font-semibold')}>{result.funnel.all.started.toLocaleString('en-IN')}</td>
            <td className={cn(td, 'font-semibold')}>{result.funnel.all.converted.toLocaleString('en-IN')}</td>
            <td className={cn(td, 'font-semibold')}>{pct(result.funnel.all.rate)}</td>
            <td className={cn(td, 'text-slate-500')}>{formatDuration(result.funnel.all.medianSeconds)}</td>
          </tr>
        </tbody>
      </>,
    )
  }

  if (result.series?.length) {
    const rows = result.series
    return wrap(
      <>
        <thead className="bg-slate-50"><tr>
          <th className={th}>{result.bucket === 'day' ? 'Day' : result.bucket === 'week' ? 'Week of' : 'Month'}</th>
          <th className={th}>This period</th>
          {compare && <th className={th}>Period before</th>}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {[...rows].reverse().map((p, ri) => {
            const i = rows.length - 1 - ri
            return (
              <tr key={p.t} className="hover:bg-slate-50/60">
                <td className={td}>{shortDay(p.t)}</td>
                <td className={td}>{formatValue(p.value, unit)}</td>
                {compare && <td className={cn(td, 'text-slate-500')}>{formatValue(result.previousSeries?.[i]?.value ?? 0, unit)}</td>}
              </tr>
            )
          })}
        </tbody>
      </>,
    )
  }

  if (result.again) {
    return wrap(
      <>
        <thead className="bg-slate-50"><tr><th className={th}>Times</th><th className={th}>Customers</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {result.again.distribution.map((d) => (
            <tr key={d.times}><td className={td}>{d.times}</td><td className={td}>{d.customers.toLocaleString('en-IN')}</td></tr>
          ))}
        </tbody>
      </>,
    )
  }
  return null
}
