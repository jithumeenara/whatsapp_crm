'use client'

import { useEffect, useState } from 'react'
import { BarChart2, Loader2, TrendingUp, CalendarCheck, CheckSquare, Users, AlertCircle } from 'lucide-react'

interface ReportData {
  leads: {
    total: number
    byStatus: { status: string; count: number }[]
    byScore: { score: string; count: number }[]
    byDay: Record<string, number>
  }
  followUps: {
    total: number
    overdue: number
    byStatus: { status: string; count: number }[]
  }
  tasks: {
    total: number
    byStatus: { status: string; count: number }[]
    byPriority: { priority: string; count: number }[]
  }
  contacts: { total: number }
  recentActivities: {
    id: string
    type: string
    title: string
    created_at: string
    user: { name: string | null } | null
    lead: { title: string } | null
    contact: { name: string | null } | null
  }[]
}

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  contacted: '#8b5cf6',
  qualified: '#f59e0b',
  converted: '#10b981',
  lost: '#ef4444',
  pending: '#f59e0b',
  done: '#10b981',
  skipped: '#6b7280',
  todo: '#6b7280',
  in_progress: '#3b82f6',
  cancelled: '#ef4444',
}

const SCORE_COLORS: Record<string, string> = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cold: '#3b82f6',
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }: {
  icon: typeof BarChart2
  label: string
  value: number | string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className={`rounded-lg p-2 bg-primary/10`}>
          <Icon className={`size-5 ${color}`} />
        </div>
      </div>
    </div>
  )
}

function BarGroup({ items, colorMap }: { items: { label: string; count: number }[]; colorMap: Record<string, string> }) {
  const max = Math.max(...items.map((i) => i.count), 1)
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-20 shrink-0 capitalize">{item.label}</span>
          <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(item.count / max) * 100}%`,
                backgroundColor: colorMap[item.label] ?? '#6b7280',
              }}
            />
          </div>
          <span className="text-xs font-medium text-foreground w-6 text-right">{item.count}</span>
        </div>
      ))}
    </div>
  )
}

function ActivityTimeline({ activities }: { activities: ReportData['recentActivities'] }) {
  const TYPE_COLORS: Record<string, string> = {
    created: 'bg-blue-500',
    stage_change: 'bg-amber-500',
    note: 'bg-purple-500',
    call: 'bg-emerald-500',
    whatsapp: 'bg-green-500',
    follow_up: 'bg-orange-500',
    flow_submitted: 'bg-teal-500',
  }

  return (
    <div className="space-y-3">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-3">
          <div className={`mt-1 size-2 rounded-full shrink-0 ${TYPE_COLORS[a.type] ?? 'bg-muted-foreground'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{a.title}</p>
            <p className="text-xs text-muted-foreground">
              {a.user?.name ?? 'System'} ·{' '}
              {a.lead?.title && <span>{a.lead.title} · </span>}
              {new Date(a.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d) => setData(d as ReportData))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const convertedCount = data.leads.byStatus.find((s) => s.status === 'converted')?.count ?? 0
  const conversionRate = data.leads.total > 0 ? Math.round((convertedCount / data.leads.total) * 100) : 0

  const doneTasksCount = data.tasks.byStatus.find((s) => s.status === 'done')?.count ?? 0
  const taskCompletion = data.tasks.total > 0 ? Math.round((doneTasksCount / data.tasks.total) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart2 className="size-6 text-primary" /> Reports & Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Overview of your CRM performance</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={TrendingUp} label="Total Leads" value={data.leads.total} sub={`${conversionRate}% conversion rate`} />
        <StatCard icon={Users} label="Total Contacts" value={data.contacts.total} color="text-purple-500" />
        <StatCard
          icon={CalendarCheck}
          label="Follow-ups"
          value={data.followUps.total}
          sub={data.followUps.overdue > 0 ? `${data.followUps.overdue} overdue` : 'All on track'}
          color={data.followUps.overdue > 0 ? 'text-red-500' : 'text-emerald-500'}
        />
        <StatCard
          icon={CheckSquare}
          label="Tasks"
          value={data.tasks.total}
          sub={`${taskCompletion}% completed`}
          color="text-amber-500"
        />
      </div>

      {/* Overdue Alert */}
      {data.followUps.overdue > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-500">
              {data.followUps.overdue} overdue follow-up{data.followUps.overdue !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Check the Follow-ups page to action pending items
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Leads by Status */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Leads by Status</h2>
          <BarGroup
            items={data.leads.byStatus.map((s) => ({ label: s.status, count: s.count }))}
            colorMap={STATUS_COLORS}
          />
        </div>

        {/* Leads by Score */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Leads by Score</h2>
          <BarGroup
            items={data.leads.byScore.map((s) => ({ label: s.score, count: s.count }))}
            colorMap={SCORE_COLORS}
          />
        </div>

        {/* Tasks by Status */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Tasks by Status</h2>
          <BarGroup
            items={data.tasks.byStatus.map((s) => ({ label: s.status, count: s.count }))}
            colorMap={STATUS_COLORS}
          />
        </div>

        {/* Follow-ups by Status */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Follow-ups by Status</h2>
          <BarGroup
            items={data.followUps.byStatus.map((s) => ({ label: s.status, count: s.count }))}
            colorMap={STATUS_COLORS}
          />
        </div>
      </div>

      {/* Leads over time (30 days) */}
      {Object.keys(data.leads.byDay).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Leads — Last 30 Days</h2>
          <div className="flex items-end gap-1 h-24">
            {Object.entries(data.leads.byDay).map(([day, count]) => {
              const maxDay = Math.max(...Object.values(data.leads.byDay), 1)
              return (
                <div
                  key={day}
                  title={`${day}: ${count} lead${count !== 1 ? 's' : ''}`}
                  className="flex-1 rounded-t bg-primary/60 hover:bg-primary transition-colors min-w-[4px]"
                  style={{ height: `${(count / maxDay) * 100}%` }}
                />
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Each bar = 1 day</p>
        </div>
      )}

      {/* Recent Activity */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h2>
        {data.recentActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet</p>
        ) : (
          <ActivityTimeline activities={data.recentActivities} />
        )}
      </div>
    </div>
  )
}
