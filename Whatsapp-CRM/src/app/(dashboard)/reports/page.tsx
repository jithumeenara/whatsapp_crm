"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts"
import {
  BarChart2, TrendingUp, CalendarCheck, CheckSquare, Users,
  ArrowUpRight, Activity,
} from "lucide-react"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

interface ReportData {
  leads: { total: number; byStatus: { status: string; count: number }[] }
  followUps: { total: number; pending: number; done: number; overdue: number }
  tasks: { total: number; pending: number; done: number; overdue: number }
  contacts: { total: number; thisWeek: number }
  recentActivity: { id: string; type: string; title: string; description?: string | null; created_at: string }[]
}

const STATUS_LABEL: Record<string, string> = {
  new:"New", call_not_connected:"Not Connected", visited:"Visited",
  appointment_fixed:"Appt Fixed", follow_up:"Follow-up", closed:"Closed",
}

const STATUS_COLORS_CHART = ["#6366f1","#f59e0b","#0ea5e9","#8b5cf6","#f97316","#10b981"]

const PIE_COLORS = ["#6366f1","#10b981","#f59e0b","#f43f5e"]

function StatCard({ label, value, sub, icon, accent }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accent)}>
          {icon}
        </div>
      </div>
      <p className="text-[28px] font-bold text-slate-900 leading-none">{value}</p>
      <p className="mt-1 text-[13px] text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-100", className)} />
}

export default function ReportsV2() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const leadChartData = (data?.leads.byStatus ?? []).map((row, i) => ({
    name: STATUS_LABEL[row.status] ?? row.status,
    count: row.count,
    fill: STATUS_COLORS_CHART[i % STATUS_COLORS_CHART.length],
  }))

  const fuPieData = data ? [
    { name: "Done",    value: data.followUps.done },
    { name: "Pending", value: data.followUps.pending },
    { name: "Overdue", value: data.followUps.overdue },
  ].filter((d) => d.value > 0) : []

  const taskPieData = data ? [
    { name: "Done",    value: data.tasks.done },
    { name: "Pending", value: data.tasks.pending },
    { name: "Overdue", value: data.tasks.overdue },
  ].filter((d) => d.value > 0) : []

  return (
    <div className="min-h-full p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50">
            <BarChart2 className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-slate-900">Reports</h1>
            <p className="text-[12px] text-slate-500">Overview of your CRM performance</p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
        {loading ? (
          [...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-[120px]" />)
        ) : (
          <>
            <StatCard
              label="Total Leads"
              value={data?.leads.total ?? 0}
              icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
              accent="bg-indigo-50"
            />
            <StatCard
              label="Follow-ups"
              value={data?.followUps.total ?? 0}
              sub={`${data?.followUps.overdue ?? 0} overdue`}
              icon={<CalendarCheck className="h-5 w-5 text-amber-600" />}
              accent="bg-amber-50"
            />
            <StatCard
              label="Tasks"
              value={data?.tasks.total ?? 0}
              sub={`${data?.tasks.overdue ?? 0} overdue`}
              icon={<CheckSquare className="h-5 w-5 text-violet-600" />}
              accent="bg-violet-50"
            />
            <StatCard
              label="Total Contacts"
              value={data?.contacts.total ?? 0}
              sub={`+${data?.contacts.thisWeek ?? 0} this week`}
              icon={<Users className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-50"
            />
          </>
        )}
      </div>

      {/* Charts grid */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Lead status bar chart */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h2 className="text-[14px] font-semibold text-slate-900 mb-4">Lead Status Breakdown</h2>
          {loading ? (
            <SkeletonBlock className="h-[200px]" />
          ) : leadChartData.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-[13px] text-slate-400">No lead data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={leadChartData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {leadChartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Follow-up pie */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h2 className="text-[14px] font-semibold text-slate-900 mb-4">Follow-up Status</h2>
          {loading ? (
            <SkeletonBlock className="h-[200px]" />
          ) : fuPieData.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-[13px] text-slate-400">No follow-up data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={fuPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {fuPieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-slate-400" />
          <h2 className="text-[14px] font-semibold text-slate-900">Recent Activity</h2>
        </div>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-12" />)}
          </div>
        ) : (data?.recentActivity ?? []).length === 0 ? (
          <p className="text-[13px] text-slate-400 py-4 text-center">No recent activity</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {(data?.recentActivity ?? []).map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 mt-0.5">
                  <Activity className="h-3.5 w-3.5 text-indigo-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-800">{item.title}</p>
                  {item.description && <p className="text-[12px] text-slate-500">{item.description}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {new Date(item.created_at).toLocaleDateString("en", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
