'use client';

import { useId, useMemo, useState } from 'react';

/**
 * The two charts the Usage tab needs, drawn as plain SVG.
 *
 * No charting library: these are a line and a two-series line over at
 * most 90 daily points, and shipping ~100KB of Recharts into every
 * Settings visit to draw them would cost more than it buys — this
 * section is meant to load fast.
 *
 * Palette: brand indigo #5B6CF9 and orange #eb6834, validated together
 * (lightness band, chroma floor, CVD separation, normal-vision floor,
 * contrast vs surface — worst adjacent protan ΔE 30.4; all checks pass).
 * Colour is never the only channel carrying identity: two series always
 * ship a legend, and the tooltip names every value.
 *
 * Deliberately NOT a dual-axis chart. Requests and tokens are different
 * units, so they get separate charts rather than two y-scales on one —
 * the usual way a usage chart becomes unreadable.
 */

export interface DailyPoint {
  day: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** The same figure in rupees, converted server-side at a stated rate
   *  so every surface shows one currency. */
  cost_inr: number;
}

const SERIES_INPUT = '#5B6CF9';
const SERIES_OUTPUT = '#eb6834';
const GRID = '#e8eaf0';
const AXIS_TEXT = '#94a3b8';

const PAD = { top: 14, right: 14, bottom: 26, left: 46 };
const WIDTH = 640;

function niceCeiling(max: number): number {
  if (max <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Both charts share axes, grid and crosshair; only the marks differ. */
function useChartGeometry(data: DailyPoint[], maxValue: number, height: number) {
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const top = niceCeiling(maxValue);

  const x = (i: number) => (data.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  // Five bands is enough to read a value off without the grid competing
  // with the data for attention.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: top * f, y: y(top * f) }));

  return { plotW, plotH, top, x, y, ticks };
}

function hoverIndexFromEvent(e: React.MouseEvent<SVGSVGElement>, length: number): number | null {
  const rect = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
  const ratio = (px - PAD.left) / (WIDTH - PAD.left - PAD.right);
  const idx = Math.round(ratio * (length - 1));
  return idx >= 0 && idx < length ? idx : null;
}

function Tooltip({
  point,
  rows,
}: {
  point: DailyPoint;
  rows: Array<{ label: string; value: string; color?: string }>;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-[11.5px] shadow-[0_4px_12px_rgba(15,23,42,0.08),0_12px_28px_-12px_rgba(15,23,42,0.3)] ring-1 ring-slate-200/80">
      <p className="font-semibold text-slate-800">{formatDay(point.day)}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <p key={r.label} className="flex items-center gap-1.5 whitespace-nowrap text-slate-600">
            {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />}
            {r.label}
            <span className="ml-auto pl-4 font-semibold tabular-nums text-slate-800">{r.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function XAxisLabels({ data, x, height }: { data: DailyPoint[]; x: (i: number) => number; height: number }) {
  // First, last and midpoint only — a tick per day is unreadable at 90
  // points and adds nothing at 7.
  const shown = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return (
    <>
      {data.map((d, i) =>
        shown.has(i) ? (
          <text
            key={d.day}
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill={AXIS_TEXT}
          >
            {formatDay(d.day)}
          </text>
        ) : null,
      )}
    </>
  );
}

function Grid({ ticks }: { ticks: Array<{ value: number; y: number }> }) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t.value}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.y} y2={t.y} stroke={GRID} strokeWidth={1} />
          <text x={PAD.left - 8} y={t.y + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
            {formatCompact(Math.round(t.value))}
          </text>
        </g>
      ))}
    </>
  );
}

export interface ChartProps {
  data: DailyPoint[];
  height?: number;
}

/** Requests per day — one series, so no legend box: the card's own title
 *  already says what is plotted. */
export function RequestsChart({ data, height = 190 }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  const maxValue = Math.max(1, ...data.map((d) => d.requests));
  const { plotH, x, y, ticks } = useChartGeometry(data, maxValue, height);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.requests)}`).join(' ');
  const area = data.length
    ? `${line} L${x(data.length - 1)},${PAD.top + plotH} L${x(0)},${PAD.top + plotH} Z`
    : '';

  return (
    <div className="relative">
      {hover !== null && data[hover] && (
        <Tooltip point={data[hover]} rows={[{ label: 'Requests', value: data[hover].requests.toLocaleString() }]} />
      )}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label="AI requests per day"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => setHover(hoverIndexFromEvent(e, data.length))}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_INPUT} stopOpacity={0.16} />
            <stop offset="100%" stopColor={SERIES_INPUT} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <Grid ticks={ticks} />

        {hover !== null && data[hover] && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke={GRID} strokeWidth={1} />
        )}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        <path d={line} fill="none" stroke={SERIES_INPUT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && data[hover] && (
          // 2px surface ring keeps the marker legible where it sits on
          // the line.
          <circle cx={x(hover)} cy={y(data[hover].requests)} r={4.5} fill={SERIES_INPUT} stroke="#ffffff" strokeWidth={2} />
        )}

        <XAxisLabels data={data} x={x} height={height} />
      </svg>
    </div>
  );
}

/** Input vs output tokens — two series in the same unit, so one shared
 *  scale is correct here, and a legend is mandatory. */
export function TokensChart({ data, height = 190 }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const maxValue = Math.max(1, ...data.map((d) => Math.max(d.input_tokens, d.output_tokens)));
  const { x, y, ticks } = useChartGeometry(data, maxValue, height);

  const series = useMemo(
    () =>
      [
        { key: 'input_tokens', label: 'Input tokens', color: SERIES_INPUT },
        { key: 'output_tokens', label: 'Output tokens', color: SERIES_OUTPUT },
      ] as const,
    [],
  );

  return (
    <div className="relative">
      {hover !== null && data[hover] && (
        <Tooltip
          point={data[hover]}
          rows={series.map((s) => ({
            label: s.label,
            value: data[hover][s.key].toLocaleString(),
            color: s.color,
          }))}
        />
      )}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label="Input and output tokens per day"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => setHover(hoverIndexFromEvent(e, data.length))}
      >
        <Grid ticks={ticks} />

        {hover !== null && data[hover] && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke={GRID} strokeWidth={1} />
        )}

        {series.map((s) => (
          <path
            key={s.key}
            d={data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[s.key])}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover !== null &&
          data[hover] &&
          series.map((s) => (
            <circle
              key={s.key}
              cx={x(hover)}
              cy={y(data[hover][s.key])}
              r={4.5}
              fill={s.color}
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}

        <XAxisLabels data={data} x={x} height={height} />
      </svg>

      <div className="mt-1 flex items-center justify-center gap-4">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Usage by feature — magnitude across categories, so a single-hue bar
 *  chart with direct value labels, not six categorical colours for what
 *  is really one measure. */
/**
 * What each feature was used for, and what it cost.
 *
 * The count alone answered the wrong question. "Voice replies: 412" says
 * nothing about whether voice is the line worth looking at — and it
 * usually is, because audio is priced well above text. The money is what
 * somebody opens this page for, so it sits beside the count, and the bar
 * is scaled by cost rather than by requests: a thousand cheap
 * classifications should not tower over the forty voice notes that
 * actually made up the bill.
 *
 * Falls back to scaling by request count when nothing has a cost yet —
 * otherwise a free-tier account gets a chart of empty bars.
 */
export function FeatureBars({
  rows,
  formatMoney,
}: {
  rows: Array<{
    feature: string;
    label: string;
    requests: number;
    total_tokens: number;
    cost_usd: number;
    cost_inr?: number;
  }>;
  /** Rendered as the account's own currency by the caller, which is the
   *  only place that knows the rate it was given. */
  formatMoney?: (value: number) => string;
}) {
  const amountOf = (r: { cost_inr?: number; cost_usd: number }) => r.cost_inr ?? r.cost_usd;
  const totalCost = rows.reduce((sum, r) => sum + amountOf(r), 0);
  const byCost = totalCost > 0;
  const max = byCost
    ? Math.max(...rows.map(amountOf))
    : Math.max(1, ...rows.map((r) => r.requests));

  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const amount = amountOf(r);
        const share = byCost ? amount / max : r.requests / max;
        return (
          <div key={r.feature}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12.5px] text-slate-700">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="text-[11.5px] text-slate-400">
                  {r.requests.toLocaleString()}×
                </span>
                <span className="text-[12.5px] font-semibold text-slate-800">
                  {formatMoney ? formatMoney(amount) : amount.toFixed(2)}
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(2, share * 100)}%`, background: SERIES_INPUT }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
