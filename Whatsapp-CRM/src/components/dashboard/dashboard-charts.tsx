"use client"

/**
 * The Dashboard's charts, in their own file so the chart library loads
 * after the numbers are on screen (next/dynamic in the page), not before.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts"

const TOOLTIP = {
  contentStyle: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    fontSize: "12px",
    boxShadow: "0 6px 20px rgba(15,23,42,0.08)",
  },
  labelStyle: { color: "#475569", fontWeight: 600, marginBottom: 4 },
}

/** The last seven days, drawn small. No axis: it answers "rising or
 *  falling", and the number beside it answers "how many". A fixed size,
 *  like its box: measured instead, it drew once at -1×-1 and warned. */
export function Sparkline({ id, data, stroke }: { id: string; data: Array<{ v: number }>; stroke: string }) {
  return (
    <AreaChart width={112} height={48} data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={2} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
    </AreaChart>
  )
}

export function TrendChart({ trend }: { trend: Array<{ day: string; Incoming: number; Outgoing: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 1, height: 260 }}>
      <AreaChart data={trend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trend-in" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="trend-out" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={18} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} />
        <Area type="monotone" dataKey="Incoming" stroke="#6366f1" strokeWidth={2.5} fill="url(#trend-in)" dot={false} />
        <Area type="monotone" dataKey="Outgoing" stroke="var(--primary)" strokeWidth={2.5} fill="url(#trend-out)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function ResponseChart({ data }: { data: Array<{ day: string; Minutes: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={190} initialDimension={{ width: 1, height: 190 }}>
      <BarChart data={data} margin={{ top: 6, right: 0, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} formatter={(v) => [`${v} min`, "Avg first reply"]} cursor={{ fill: "#f8fafc" }} />
        <Bar dataKey="Minutes" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  )
}
