'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  X, Flame, Thermometer, Snowflake, CheckCircle2,
  TrendingUp, ChevronDown, ChevronRight,
  ExternalLink, User, Calendar, XCircle,
  Phone, PhoneOff, MessageSquare, Activity,
} from 'lucide-react'
import type { LeadActivity } from '@/types'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDT(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_CHIP: Record<string, string> = {
  new:                'bg-indigo-50 text-indigo-700 border-indigo-100',
  call_not_connected: 'bg-rose-50 text-rose-700 border-rose-100',
  visited:            'bg-sky-50 text-sky-700 border-sky-100',
  appointment_fixed:  'bg-violet-50 text-violet-700 border-violet-100',
  follow_up:          'bg-orange-50 text-orange-700 border-orange-100',
  closed:             'bg-emerald-50 text-emerald-700 border-emerald-100',
}
const STATUS_LABEL: Record<string, string> = {
  new: 'New', call_not_connected: 'Not Connected', visited: 'Visited',
  appointment_fixed: 'Appt Fixed', follow_up: 'Follow-up', closed: 'Closed',
}

function ScoreIcon({ score }: { score: string }) {
  if (score === 'hot')  return <Flame className="h-3.5 w-3.5 text-rose-500" />
  if (score === 'warm') return <Thermometer className="h-3.5 w-3.5 text-amber-500" />
  return <Snowflake className="h-3.5 w-3.5 text-sky-400" />
}

// ── Activity mini-timeline (inline, compact) ──────────────────────────────────

const ACT_ICON: Record<string, React.ReactNode> = {
  created:      <TrendingUp className="size-3 text-indigo-500" />,
  stage_change: <Activity className="size-3 text-purple-500" />,
  follow_up:    <Calendar className="size-3 text-amber-500" />,
  note:         <MessageSquare className="size-3 text-slate-400" />,
  call:         <PhoneOff className="size-3 text-rose-500" />,
  closed:       <CheckCircle2 className="size-3 text-emerald-500" />,
}
const ACT_ICON_BG: Record<string, string> = {
  created:      'bg-indigo-50 border-indigo-100',
  stage_change: 'bg-purple-50 border-purple-100',
  follow_up:    'bg-amber-50 border-amber-100',
  note:         'bg-slate-50 border-slate-200',
  call:         'bg-rose-50 border-rose-100',
  closed:       'bg-emerald-50 border-emerald-100',
}

function MiniTimeline({ activities, leadCreatedAt }: { activities: LeadActivity[]; leadCreatedAt: string }) {
  return (
    <div className="space-y-0 py-1">
      {/* synthetic Lead Created */}
      <TimelineRow
        icon={<TrendingUp className="size-3 text-indigo-600" />}
        iconBg="bg-indigo-50 border-indigo-200"
        title="Lead Created"
        time={leadCreatedAt}
        isLast={activities.length === 0}
      />
      {activities.map((act, idx) => (
        <TimelineRow
          key={act.id}
          icon={ACT_ICON[act.type] ?? <MessageSquare className="size-3 text-slate-400" />}
          iconBg={ACT_ICON_BG[act.type] ?? 'bg-slate-50 border-slate-200'}
          title={act.title}
          description={act.description ?? undefined}
          time={act.created_at}
          byName={act.user?.profile?.full_name ?? undefined}
          isLast={idx === activities.length - 1}
        />
      ))}
    </div>
  )
}

function TimelineRow({
  icon, iconBg, title, description, time, byName, isLast,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  description?: string
  time: string
  byName?: string
  isLast: boolean
}) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={cn('flex-shrink-0 mt-0.5 flex items-center justify-center rounded-full border size-5', iconBg)}>
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-slate-100 mt-0.5" style={{ minHeight: 14 }} />}
      </div>
      <div className="pb-2.5 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-semibold text-slate-800 leading-tight">{title}</p>
          <p className="text-[10px] text-slate-400 shrink-0 mt-0.5">{fmtDT(time)}</p>
        </div>
        {description && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{description}</p>}
        {byName && <p className="text-[10px] text-slate-400 mt-0.5">by {byName}</p>}
      </div>
    </div>
  )
}

// ── Lead history card ─────────────────────────────────────────────────────────

interface LeadRecord {
  id: string
  title: string
  status: string
  score: string
  source: string
  lost_reason: string | null
  closing_remarks: string | null
  created_at: string
  converted_at: string | null
  updated_at: string
  assignee?: { email: string; profile?: { full_name?: string | null } | null } | null
  activities: LeadActivity[]
  _count: { activities: number; follow_ups: number }
}

function LeadHistoryCard({
  lead, isCurrent, defaultExpanded, onNavigate,
}: {
  lead: LeadRecord
  isCurrent: boolean
  defaultExpanded: boolean
  onNavigate: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isClosed = lead.status === 'closed'
  const agentName = lead.assignee?.profile?.full_name ?? lead.assignee?.email ?? null

  const borderColor = isCurrent
    ? 'border-indigo-300 shadow-[0_0_0_2px_rgba(99,102,241,0.15)]'
    : isClosed
    ? 'border-emerald-200'
    : 'border-slate-200'

  const headerBg = isCurrent
    ? 'bg-indigo-50/70'
    : isClosed
    ? 'bg-emerald-50/50'
    : 'bg-slate-50/60'

  const leftBarColor = isCurrent
    ? 'bg-indigo-500'
    : isClosed
    ? 'bg-emerald-500'
    : 'bg-slate-300'

  return (
    <div className={cn('rounded-xl border overflow-hidden transition-all', borderColor)}>
      {/* Left accent bar */}
      <div className="flex">
        <div className={cn('w-1 shrink-0', leftBarColor)} />
        <div className="flex-1 min-w-0">
          {/* Card header — div not button to avoid nested-button hydration error */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setExpanded((v) => !v)}
            onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
            className={cn(
              'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer select-none',
              headerBg,
              'hover:bg-slate-100/60',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-slate-900 truncate max-w-[200px]">
                  {lead.title}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 uppercase tracking-wide">
                    Current
                  </span>
                )}
                <span className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  STATUS_CHIP[lead.status] ?? 'bg-slate-50 text-slate-600 border-slate-200',
                )}>
                  {STATUS_LABEL[lead.status] ?? lead.status}
                </span>
                <ScoreIcon score={lead.score} />
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Calendar className="h-3 w-3" />
                  {fmtDate(lead.created_at)}
                  {isClosed && lead.converted_at && (
                    <> → {fmtDate(lead.converted_at)}</>
                  )}
                </span>
                {agentName && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <User className="h-3 w-3" />
                    {agentName}
                  </span>
                )}
                <span className="text-[11px] text-slate-400">
                  {lead._count.activities + 1} event{lead._count.activities + 1 !== 1 ? 's' : ''}
                </span>
              </div>
              {isClosed && lead.lost_reason && (
                <div className="mt-1.5 flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-emerald-600 shrink-0" />
                  <span className="text-[11px] font-semibold text-emerald-700">{lead.lost_reason}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigate(lead.id) }}
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                title="Open lead"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              {expanded
                ? <ChevronDown className="h-4 w-4 text-slate-400" />
                : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </div>
          </div>

          {/* Activity timeline */}
          {expanded && (
            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {lead.activities.length === 0 && !isClosed ? (
                <p className="text-[11px] text-slate-400 italic">No call history recorded yet.</p>
              ) : lead.activities.length === 0 && isClosed ? (
                <p className="text-[11px] text-slate-400 italic">No call history was recorded before this lead was closed.</p>
              ) : (
                <MiniTimeline
                  activities={lead.activities}
                  leadCreatedAt={lead.created_at}
                />
              )}
              {isClosed && lead.closing_remarks && (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Closing Remarks</p>
                  <p className="text-[12px] text-slate-700">{lead.closing_remarks}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface ContactLeadHistoryModalProps {
  contactId: string
  contactName: string
  currentLeadId: string
  onClose: () => void
}

export function ContactLeadHistoryModal({
  contactId, contactName, currentLeadId, onClose,
}: ContactLeadHistoryModalProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [counts, setCounts] = useState({ total: 0, active: 0, closed: 0 })

  useEffect(() => {
    setLoading(true)
    fetch(`/api/contacts/${contactId}/leads/history`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        setLeads(d.leads ?? [])
        setCounts(d.counts ?? { total: 0, active: 0, closed: 0 })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [contactId])

  function handleNavigate(leadId: string) {
    if (leadId !== currentLeadId) {
      router.push(`/leads/${leadId}`)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
            <Phone className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-slate-900 truncate">Lead History</p>
            <p className="text-[12px] text-slate-500 truncate">{contactName}</p>
          </div>
          {/* Count chips */}
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {counts.total} total
            </span>
            {counts.active > 0 && (
              <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                {counts.active} active
              </span>
            )}
            {counts.closed > 0 && (
              <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                {counts.closed} closed
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="animate-pulse rounded-xl border border-slate-100 overflow-hidden">
                  <div className="h-16 bg-slate-50" />
                </div>
              ))}
            </div>
          ) : leads.length === 0 ? (
            <p className="text-center text-[13px] text-slate-400 py-8">No leads found for this contact.</p>
          ) : (
            leads.map((lead, idx) => (
              <LeadHistoryCard
                key={lead.id}
                lead={lead}
                isCurrent={lead.id === currentLeadId}
                defaultExpanded={lead.id === currentLeadId || idx === 0}
                onNavigate={handleNavigate}
              />
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 shrink-0">
          <p className="text-[11px] text-slate-400 text-center">
            Showing all {counts.total} lead{counts.total !== 1 ? 's' : ''} for this contact · Click any lead to expand its timeline
          </p>
        </div>
      </div>
    </div>
  )
}
