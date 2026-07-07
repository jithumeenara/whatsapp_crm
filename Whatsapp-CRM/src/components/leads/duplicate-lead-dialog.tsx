"use client"

import { useRouter } from "next/navigation"
import {
  AlertTriangle, User, Phone, Mail, X,
  ExternalLink, RefreshCw, UserPlus, Clock,
  Flame, Thermometer, Snowflake,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

interface LeadSummary {
  id: string
  title: string
  status: string
  score: string
  created_at: string
  converted_at: string | null
  assigned_to: string | null
  assignee?: {
    id: string
    email: string
    profile?: { full_name?: string | null; avatar_url?: string | null } | null
  } | null
}

export interface DuplicateInfo {
  contact: {
    id: string
    name?: string | null
    phone?: string | null
    email?: string | null
    avatar_url?: string | null
  }
  leads: LeadSummary[]
  counts: { total: number; active: number; closed: number }
  activeLead: LeadSummary | null
  lastActivityAt: string | null
}

interface Props {
  info: DuplicateInfo
  onOpenContact: () => void
  onContinueActiveLead: () => void
  onCreateAnyway: () => void
  onCancel: () => void
  creating?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  new: "New", call_not_connected: "Not Connected", visited: "Visited",
  appointment_fixed: "Appt Fixed", follow_up: "Follow-up", closed: "Closed",
}
const STATUS_COLOR: Record<string, string> = {
  new: "bg-indigo-50 text-indigo-700",
  call_not_connected: "bg-rose-50 text-rose-700",
  visited: "bg-sky-50 text-sky-700",
  appointment_fixed: "bg-violet-50 text-violet-700",
  follow_up: "bg-orange-50 text-orange-700",
  closed: "bg-emerald-50 text-emerald-700",
}

function ScoreIcon({ score }: { score: string }) {
  if (score === "hot")  return <Flame className="h-3 w-3 text-rose-500" />
  if (score === "warm") return <Thermometer className="h-3 w-3 text-amber-500" />
  return <Snowflake className="h-3 w-3 text-sky-500" />
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function relTime(iso: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  if (d < 30) return `${d}d ago`
  const m = Math.floor(d / 30)
  if (m < 12) return `${m}mo ago`
  return `${Math.floor(m / 12)}y ago`
}

function initials(name?: string | null, phone?: string | null) {
  if (name) return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
  return phone?.slice(-2) ?? "??"
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DuplicateLeadDialog({
  info, onOpenContact, onContinueActiveLead, onCreateAnyway, onCancel, creating,
}: Props) {
  const { contact, counts, activeLead, lastActivityAt } = info
  const agentName = activeLead?.assignee?.profile?.full_name
    ?? activeLead?.assignee?.email
    ?? null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden z-10">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 bg-amber-50">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-slate-900">Existing Customer Found</p>
              <p className="text-[12px] text-slate-500 mt-0.5">
                This contact already has {counts.total} lead{counts.total !== 1 ? "s" : ""} in the system.
              </p>
            </div>
          </div>
          <button
            type="button" onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contact card */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-[13px] font-bold">
              {initials(contact.name, contact.phone)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-slate-900 truncate">
                {contact.name ?? "Unknown"}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                {contact.phone && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Phone className="h-3 w-3" />{contact.phone}
                  </span>
                )}
                {contact.email && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Mail className="h-3 w-3" />{contact.email}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Lead counts */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-center">
              <p className="text-[18px] font-bold text-slate-800">{counts.total}</p>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Total</p>
            </div>
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-2.5 text-center">
              <p className="text-[18px] font-bold text-orange-700">{counts.active}</p>
              <p className="text-[10px] text-orange-600 font-medium uppercase tracking-wide">Active</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 text-center">
              <p className="text-[18px] font-bold text-emerald-700">{counts.closed}</p>
              <p className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">Closed</p>
            </div>
          </div>

          {/* Extra meta */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {lastActivityAt && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <Clock className="h-3 w-3" />Last contact: {relTime(lastActivityAt)}
              </span>
            )}
            {agentName && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <User className="h-3 w-3" />Agent: {agentName}
              </span>
            )}
          </div>
        </div>

        {/* Active lead preview */}
        {activeLead && (
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Active Lead</p>
            <div className="flex items-center gap-2">
              <ScoreIcon score={activeLead.score} />
              <p className="flex-1 text-[13px] font-medium text-slate-800 truncate">{activeLead.title}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[activeLead.status] ?? "bg-slate-100 text-slate-600"}`}>
                {STATUS_LABEL[activeLead.status] ?? activeLead.status}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Created {fmtDate(activeLead.created_at)}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-5 py-4 space-y-2">
          {/* Primary: open contact */}
          <button
            type="button"
            onClick={onOpenContact}
            className="w-full flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left hover:bg-indigo-100 transition-colors group"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 group-hover:bg-indigo-200 transition-colors">
              <ExternalLink className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-indigo-900">Open Customer Profile</p>
              <p className="text-[11px] text-indigo-600">View all leads and contact history</p>
            </div>
          </button>

          {/* Continue active lead */}
          {activeLead && (
            <button
              type="button"
              onClick={onContinueActiveLead}
              className="w-full flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-left hover:bg-orange-100 transition-colors group"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 group-hover:bg-orange-200 transition-colors">
                <RefreshCw className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-orange-900">Continue Active Lead</p>
                <p className="text-[11px] text-orange-600 truncate">Open "{activeLead.title}"</p>
              </div>
            </button>
          )}

          {/* Create new lead anyway */}
          <button
            type="button"
            onClick={onCreateAnyway}
            disabled={creating}
            className="w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50 transition-colors group"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 group-hover:bg-slate-200 transition-colors">
              {creating
                ? <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                : <UserPlus className="h-4 w-4 text-slate-600" />
              }
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Create New Lead Anyway</p>
              <p className="text-[11px] text-slate-500">Add a fresh enquiry for this customer</p>
            </div>
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
