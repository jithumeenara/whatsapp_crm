"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  TrendingUp, Plus, Search, RefreshCw, Flame, Snowflake,
  Thermometer, MapPin, Phone, User, UserCheck,
  X, Filter, MoreHorizontal, Trash2, EyeOff, Eye, AlertTriangle,
  LayoutGrid, Table2, ChevronRight, Clock, Calendar, CheckSquare,
  Sparkles, CheckCircle2, Bell, UserPlus, Globe, Megaphone, Share2, Bot,
} from "lucide-react"
import { toast } from "sonner"
import type { Lead } from "@/types"
import { useAuth } from "@/hooks/use-auth"
import { useRealtime } from "@/hooks/use-realtime"
import { DuplicateLeadDialog, type DuplicateInfo } from "@/components/leads/duplicate-lead-dialog"

// ---- types ----

interface FollowUp {
  id: string; status: string; due_at: string; note?: string | null
  lead?: { id: string; title: string } | null
  contact?: { id: string; name?: string | null; phone?: string | null } | null
  assignee?: { email: string; profile?: { full_name?: string | null } | null } | null
}
interface Task {
  id: string; title: string; status: string; priority: string; due_date?: string | null; description?: string | null
  lead?: { id: string; title: string } | null
  contact?: { id: string; name?: string | null; phone?: string | null } | null
  assignee?: { email: string; profile?: { full_name?: string | null } | null } | null
}

// ---- constants ----

const KERALA_DISTRICTS = [
  "Thiruvananthapuram","Kollam","Pathanamthitta","Alappuzha",
  "Kottayam","Idukki","Ernakulam","Thrissur","Palakkad",
  "Malappuram","Kozhikode","Wayanad","Kannur","Kasaragod",
]
const SOURCES = ["whatsapp","instagram","website","campaign","referral","manual"]

interface TabDef { key: string; label: string; color: string; icon?: React.ReactNode }

const TABS: TabDef[] = [
  { key: "all",       label: "All Leads",  color: "text-slate-600"  },
  { key: "new_pool",  label: "New Pool",   color: "text-indigo-600" },
  { key: "follow_up", label: "Follow-up",  color: "text-orange-600" },
  { key: "closed",    label: "Closed",     color: "text-emerald-600"},
  { key: "tasks",     label: "Tasks",      color: "text-violet-600" },
]

const TAB_DOT: Record<string, string> = {
  all: "bg-slate-400",
  new_pool: "bg-indigo-500",
  follow_up: "bg-orange-500",
  closed: "bg-emerald-500",
  tasks: "bg-violet-500",
}

const STATUS_CHIP: Record<string, string> = {
  new:                "bg-indigo-50 text-indigo-700 border-indigo-100",
  call_not_connected: "bg-rose-50 text-rose-700 border-rose-100",
  visited:            "bg-sky-50 text-sky-700 border-sky-100",
  appointment_fixed:  "bg-violet-50 text-violet-700 border-violet-100",
  follow_up:          "bg-orange-50 text-orange-700 border-orange-100",
  closed:             "bg-emerald-50 text-emerald-700 border-emerald-100",
}

const STATUS_LABEL: Record<string, string> = {
  new:"New", call_not_connected:"Not Connected", visited:"Visited",
  appointment_fixed:"Appt Fixed", follow_up:"Follow-up", closed:"Closed",
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp:"WhatsApp", instagram:"Instagram", website:"Website",
  campaign:"Campaign", referral:"Referral", manual:"Manual",
}

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

function initials(name: string | null | undefined, phone: string) {
  if (name) return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
  return phone.slice(-2)
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function isPast(iso: string) { return new Date(iso) < new Date() }

interface TagItem { id: string; name: string; color: string }

// ---- score badge ----

function ScoreBadge({ score }: { score: string }) {
  if (score === "hot")  return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-rose-500"><Flame className="h-3 w-3" />Hot</span>
  if (score === "warm") return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-500"><Thermometer className="h-3 w-3" />Warm</span>
  return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-500"><Snowflake className="h-3 w-3" />Cold</span>
}

// ---- source badge ----

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  )
}

// Platform overrides — these always get their real brand SVG regardless of settings icon field
const PLATFORM_OVERRIDES: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
  whatsapp: { icon: <WhatsAppIcon className="h-3 w-3" />, bg: "bg-emerald-50", text: "text-emerald-700" },
  chatbot:  { icon: <Bot className="h-3 w-3" />,          bg: "bg-emerald-50", text: "text-emerald-700" },
  instagram:{ icon: <InstagramIcon className="h-3 w-3" />, bg: "bg-pink-50",   text: "text-pink-700"   },
  website:  { icon: <Globe className="h-3 w-3" />,         bg: "bg-blue-50",   text: "text-blue-700"   },
  campaign: { icon: <Megaphone className="h-3 w-3" />,     bg: "bg-violet-50", text: "text-violet-700" },
  referral: { icon: <Share2 className="h-3 w-3" />,        bg: "bg-amber-50",  text: "text-amber-700"  },
  manual:   { icon: <UserPlus className="h-3 w-3" />,      bg: "bg-slate-100", text: "text-slate-600"  },
}

function SourceBadge({ source, sources }: { source?: string | null; sources?: { icon: string; label: string }[] }) {
  const raw = (source ?? "manual").trim()
  const slug = raw.toLowerCase().replace(/[\s_-]+/g, "_")

  // Match against dynamic sources list (exact slug or label)
  const match = sources?.find(s =>
    s.label.toLowerCase().replace(/[\s_-]+/g, "_") === slug || s.label.toLowerCase() === raw.toLowerCase()
  )
  const label = match?.label ?? formatSourceLabel(raw)
  const labelSlug = label.toLowerCase().replace(/[\s_-]+/g, "_")

  // Exact platform override, then slug override, then keyword fallback for legacy values (e.g. "whatsapp_flow")
  const override =
    PLATFORM_OVERRIDES[labelSlug] ??
    PLATFORM_OVERRIDES[slug] ??
    (slug.includes("whatsapp") ? PLATFORM_OVERRIDES.whatsapp :
     slug.includes("instagram") ? PLATFORM_OVERRIDES.instagram :
     slug.includes("website")   ? PLATFORM_OVERRIDES.website :
     slug.includes("campaign")  ? PLATFORM_OVERRIDES.campaign :
     slug.includes("referral")  ? PLATFORM_OVERRIDES.referral :
     null)

  const customIcon = match?.icon
    ? (match.icon.startsWith("data:") || match.icon.startsWith("http") || match.icon.startsWith("/"))
      ? <img src={match.icon} alt="" className="h-3 w-3 object-contain rounded-sm" />
      : <span className="text-[11px] leading-none">{match.icon}</span>
    : null
  const icon = override?.icon ?? customIcon ?? <UserPlus className="h-3 w-3" />
  const bg   = override?.bg   ?? "bg-slate-100"
  const text = override?.text ?? "text-slate-600"

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${bg} ${text}`}>
      {icon}{label}
    </span>
  )
}

function formatSourceLabel(raw: string) {
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---- create lead dialog ----

interface ContactOption { id: string; name?: string | null; phone?: string | null; email?: string | null }

function CreateLeadDialog({
  open, onClose, onSaved, scoringMode, scoreOptions, sourceOptions,
}: { open: boolean; onClose: () => void; onSaved: () => void; scoringMode: string; scoreOptions: { icon: string; label: string }[]; sourceOptions: { icon: string; label: string }[] }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const [pendingForm, setPendingForm] = useState<Record<string, string> | null>(null)

  // Contact search
  const [contactQuery, setContactQuery] = useState("")
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([])
  const [contactSearching, setContactSearching] = useState(false)
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null)
  const [showContactDropdown, setShowContactDropdown] = useState(false)
  const contactTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [form, setForm] = useState({
    title: "", source: sourceOptions.find(s => s.label.toLowerCase() === "manual")?.label ?? sourceOptions[0]?.label ?? "manual",
    status: "new", score: (scoreOptions[1] ?? scoreOptions[0])?.label ?? "",
    lead_quality: "", district: "", place: "", notes: "",
  })

  function resetAll() {
    setForm({ title: "", source: sourceOptions.find(s => s.label.toLowerCase() === "manual")?.label ?? sourceOptions[0]?.label ?? "manual", status: "new", score: (scoreOptions[1] ?? scoreOptions[0])?.label ?? "", lead_quality: "", district: "", place: "", notes: "" })
    setSelectedContact(null); setContactQuery(""); setContactOptions([])
    setDuplicateInfo(null); setPendingForm(null)
  }

  function handleContactSearch(v: string) {
    setContactQuery(v)
    setSelectedContact(null)
    if (contactTimer.current) clearTimeout(contactTimer.current)
    if (v.trim().length < 2) { setContactOptions([]); return }
    contactTimer.current = setTimeout(async () => {
      setContactSearching(true)
      try {
        const r = await fetch(`/api/contacts?search=${encodeURIComponent(v.trim())}&limit=8`).then((x) => x.json())
        setContactOptions(r.contacts ?? r ?? [])
        setShowContactDropdown(true)
      } catch { /* ignore */ }
      finally { setContactSearching(false) }
    }, 300)
  }

  async function doCreate(formData: Record<string, string>, contactId: string | null, force = false) {
    setSaving(true)
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, contact_id: contactId ?? undefined, force_create: force }),
      })
      if (res.status === 409) {
        const data = await res.json()
        if (data.duplicate) {
          setPendingForm({ ...formData, contact_id: contactId ?? "" })
          setDuplicateInfo(data as DuplicateInfo)
          return
        }
      }
      if (!res.ok) throw new Error("Failed")
      toast.success("Lead created")
      onSaved(); onClose(); resetAll()
    } catch {
      toast.error("Failed to create lead")
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    // If the user typed in the contact search but never selected from the dropdown,
    // the contact_id would be null and duplicate detection would be skipped.
    // Force them to either pick a contact or clear the field.
    if (contactQuery.trim().length > 0 && !selectedContact) {
      toast.error("Please select a contact from the dropdown or clear the contact field.")
      return
    }
    await doCreate(form, selectedContact?.id ?? null)
  }

  // Duplicate dialog actions
  function handleOpenContact() {
    if (duplicateInfo?.contact?.id) {
      router.push(`/contacts/${duplicateInfo.contact.id}`)
      onClose(); resetAll()
    }
  }
  function handleContinueActive() {
    if (duplicateInfo?.activeLead?.id) {
      router.push(`/leads/${duplicateInfo.activeLead.id}`)
      onClose(); resetAll()
    }
  }
  async function handleCreateAnyway() {
    if (!pendingForm) return
    await doCreate(pendingForm, pendingForm.contact_id || null, true)
    setDuplicateInfo(null)
  }

  if (!open) return null
  return (
    <>
      {duplicateInfo && (
        <DuplicateLeadDialog
          info={duplicateInfo}
          creating={saving}
          onOpenContact={handleOpenContact}
          onContinueActiveLead={handleContinueActive}
          onCreateAnyway={handleCreateAnyway}
          onCancel={() => { setDuplicateInfo(null); setPendingForm(null) }}
        />
      )}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-white rounded-t-2xl">
          <h2 className="text-[15px] font-semibold text-slate-900">New Lead</h2>
          <button type="button" onClick={() => { onClose(); resetAll() }} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">

          {/* Contact picker */}
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Contact</label>
            <div className="relative">
              {selectedContact ? (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-200 text-[10px] font-bold text-indigo-700">
                    {(selectedContact.name ?? selectedContact.phone ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="flex-1 text-[13px] font-medium text-slate-900 truncate">
                    {selectedContact.name ?? selectedContact.phone}
                  </span>
                  {selectedContact.phone && (
                    <span className="text-[11px] text-slate-500 shrink-0">{selectedContact.phone}</span>
                  )}
                  <button type="button" onClick={() => { setSelectedContact(null); setContactQuery("") }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none pr-8"
                    placeholder="Search by name or phone…"
                    value={contactQuery}
                    onChange={(e) => handleContactSearch(e.target.value)}
                    onFocus={() => contactOptions.length > 0 && setShowContactDropdown(true)}
                    onBlur={() => setTimeout(() => setShowContactDropdown(false), 150)}
                    autoComplete="off"
                  />
                  {contactSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
                  )}
                  {showContactDropdown && contactOptions.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                      {contactOptions.map((c) => (
                        <button
                          key={c.id} type="button"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-indigo-50 text-left transition-colors"
                          onMouseDown={() => { setSelectedContact(c); setContactQuery(c.name ?? c.phone ?? ""); setShowContactDropdown(false) }}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            {(c.name ?? c.phone ?? "?")[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-slate-900 truncate">{c.name ?? "No name"}</p>
                            {c.phone && <p className="text-[11px] text-slate-500">{c.phone}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Lead Title *</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
              placeholder="e.g. Building Project, Hospital Enquiry"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Source</label>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              >
                {sourceOptions.map(({ icon, label }) => <option key={label} value={label}>{icon ? icon + " " : ""}{label}</option>)}
              </select>
            </div>
            {(scoringMode === "score" || scoringMode === "both") && (
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Score</label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                  value={form.score}
                  onChange={(e) => setForm((f) => ({ ...f, score: e.target.value }))}
                >
                  {scoreOptions.map(({ icon, label }) => <option key={label} value={label}>{icon ? icon + " " : ""}{label}</option>)}
                </select>
              </div>
            )}
          </div>

          {(scoringMode === "quality" || scoringMode === "both") && (
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Quality</label>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                value={form.lead_quality}
                onChange={(e) => setForm((f) => ({ ...f, lead_quality: e.target.value }))}
              >
                <option value="">— select —</option>
                <option value="qualified">Qualified</option>
                <option value="not_qualified">Not Qualified</option>
                <option value="wrong_enquiry">Wrong Enquiry</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">District</label>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              >
                <option value="">— select —</option>
                {KERALA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Place</label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                placeholder="Town / area"
                value={form.place}
                onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Notes</label>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"
              placeholder="Optional notes…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { onClose(); resetAll() }}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !form.title.trim()}
              className="flex-1 rounded-lg py-2 text-[13px] font-medium text-white disabled:opacity-50 transition-colors bg-indigo-600 hover:bg-indigo-700">
              {saving ? "Saving…" : "Create Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  )
}

// ---- confirm dialog ----

function ConfirmDialog({
  open, title, description, confirmLabel, danger,
  onConfirm, onCancel, loading,
}: {
  open: boolean; title: string; description: string
  confirmLabel: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void; loading?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
        <div className={cn("px-5 pt-5 pb-4", danger ? "bg-rose-50/60" : "bg-slate-50/60")}>
          <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-xl",
            danger ? "bg-rose-100" : "bg-indigo-100")}>
            <AlertTriangle className={cn("h-5 w-5", danger ? "text-rose-600" : "text-indigo-600")} />
          </div>
          <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{description}</p>
        </div>
        <div className="flex gap-3 px-5 py-4 bg-white border-t border-slate-100">
          <button type="button" onClick={onCancel} disabled={loading}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className={cn("flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-50",
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700")}>
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- shared card menu ----

function LeadMenu({ lead, menuOpenId, onMenuToggle, onDelete, onHide, onAddToPipeline }: {
  lead: Lead; menuOpenId: string | null
  onMenuToggle: (id: string) => void
  onDelete: (id: string) => void
  onHide: (id: string, hidden: boolean) => void
  onAddToPipeline: (lead: Lead) => void
}) {
  const isMenuOpen = menuOpenId === lead.id
  const isHidden = (lead as unknown as Record<string, unknown>).is_hidden === true
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => onMenuToggle(lead.id)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isMenuOpen && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl border border-slate-200 bg-white shadow-xl py-1 ring-1 ring-black/5">
          <button type="button"
            onClick={() => { onAddToPipeline(lead); onMenuToggle(lead.id) }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-indigo-700 hover:bg-indigo-50 transition-colors">
            <ChevronRight className="h-3.5 w-3.5 text-indigo-500" /> Add to Pipeline
          </button>
          <div className="mx-3 my-1 border-t border-slate-100" />
          <button type="button"
            onClick={() => { onHide(lead.id, !isHidden); onMenuToggle(lead.id) }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
            {isHidden
              ? <><Eye className="h-3.5 w-3.5 text-indigo-500" /> Show to Agents</>
              : <><EyeOff className="h-3.5 w-3.5 text-slate-400" /> Hide from Agents</>}
          </button>
          <div className="mx-3 my-1 border-t border-slate-100" />
          <button type="button"
            onClick={() => { onDelete(lead.id); onMenuToggle(lead.id) }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-rose-600 hover:bg-rose-50 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Delete Lead
          </button>
        </div>
      )}
    </div>
  )
}

// ---- tile card ----

const STATUS_BAR: Record<string, string> = {
  new:                "bg-indigo-500",
  call_not_connected: "bg-rose-500",
  visited:            "bg-sky-500",
  appointment_fixed:  "bg-violet-500",
  follow_up:          "bg-orange-500",
  closed:             "bg-emerald-500",
}

function LeadTile({
  lead, tab, scoringMode, menuOpenId, sources, onPick, onOpen, onMenuToggle, onDelete, onHide, onAddToPipeline,
}: {
  lead: Lead; tab: string; scoringMode: string; menuOpenId: string | null
  sources: { icon: string; label: string }[]
  onPick: (id: string) => void; onOpen: (id: string) => void
  onMenuToggle: (id: string) => void
  onDelete: (id: string) => void
  onHide: (id: string, hidden: boolean) => void
  onAddToPipeline: (lead: Lead) => void
}) {
  const contactName = lead.contact?.name
  const phone = lead.contact?.phone ?? ""
  const ini = initials(contactName, phone)
  const isHidden = (lead as unknown as Record<string, unknown>).is_hidden === true
  const isNew = lead.status === "new" && tab === "all"
  const isUnassigned = !lead.assignee
  const showPick = isUnassigned && (tab === "new_pool" || tab === "all")

  return (
    <div onClick={() => onOpen(lead.id)}
      className={cn(
        "group relative rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-pointer hover:shadow-[0_8px_24px_rgba(99,102,241,0.12)] hover:border-indigo-200 hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col",
        isNew ? "bg-indigo-50/60 border-indigo-200" : "bg-white border-slate-100"
      )}>

      {/* Status colour bar */}
      <div className={cn("h-1 w-full shrink-0", STATUS_BAR[lead.status] ?? "bg-slate-300")} />

      {/* New badge strip */}
      {isNew && (
        <div className="flex items-center gap-1 bg-indigo-600 px-3 py-1">
          <Sparkles className="h-3 w-3 text-white/80" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wider">New Lead</span>
        </div>
      )}

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Top row: avatar + name + menu */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[15px] font-black tracking-tight shadow-sm",
            isHidden ? "bg-slate-100 text-slate-400" : isNew ? "bg-indigo-600 text-white" : "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
          )}>
            {ini}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className={cn("text-[15px] font-bold leading-tight truncate",
                isHidden ? "text-slate-400" : "text-slate-900")}>
                {lead.title}
              </p>
              {isHidden && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  <EyeOff className="h-2.5 w-2.5" /> Hidden
                </span>
              )}
            </div>
            {contactName && (
              <p className="text-[12px] text-slate-500 truncate mt-0.5">{contactName}</p>
            )}
          </div>
          <div className="relative shrink-0">
            <LeadMenu lead={lead} menuOpenId={menuOpenId}
              onMenuToggle={onMenuToggle} onDelete={onDelete} onHide={onHide} onAddToPipeline={onAddToPipeline} />
          </div>
        </div>

        {/* Status + score badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-bold",
            STATUS_CHIP[lead.status] ?? "bg-slate-50 text-slate-600 border-slate-100"
          )}>
            {STATUS_LABEL[lead.status] ?? lead.status}
          </span>
          {(scoringMode === "score" || scoringMode === "both") && (
            <ScoreBadge score={lead.score} />
          )}
        </div>

        {/* Phone + district */}
        <div className="space-y-1.5">
          {phone && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-[13px] font-medium text-slate-700 tracking-wide">{phone}</span>
            </div>
          )}
          {lead.district && (
            <div className="flex items-center gap-2 px-1">
              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="text-[12px] text-slate-500">
                {lead.district}{lead.place ? `, ${lead.place}` : ""}
              </span>
            </div>
          )}
        </div>

        {/* Footer: assignee + time */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
          {lead.assignee ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-bold text-indigo-700 shrink-0">
                {(lead.assignee.profile?.full_name ?? lead.assignee.email ?? "?")[0].toUpperCase()}
              </div>
              {lead.assignee.profile?.full_name ?? lead.assignee.email ?? "Agent"}
            </span>
          ) : showPick ? (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onPick(lead.id) }}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200">
              + Pick Lead
            </button>
          ) : (
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <User className="h-3 w-3" /> Unassigned
            </span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <SourceBadge source={lead.source} sources={sources} />
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Clock className="h-3 w-3" />
              {relTime(lead.updated_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- table row ----

function LeadRow({
  lead, index, tab, scoringMode, menuOpenId, sources, onPick, onOpen, onMenuToggle, onDelete, onHide, onAddToPipeline,
}: {
  lead: Lead; index: number; tab: string; scoringMode: string; menuOpenId: string | null
  sources: { icon: string; label: string }[]
  onPick: (id: string) => void; onOpen: (id: string) => void
  onMenuToggle: (id: string) => void
  onDelete: (id: string) => void
  onHide: (id: string, hidden: boolean) => void
  onAddToPipeline: (lead: Lead) => void
}) {
  const contactName = lead.contact?.name
  const phone = lead.contact?.phone ?? ""
  const ini = initials(contactName, phone)
  const isHidden = (lead as unknown as Record<string, unknown>).is_hidden === true
  const isNew = lead.status === "new" && tab === "all"
  const isOdd = index % 2 !== 0
  const isUnassigned = !lead.assignee
  const showPick = isUnassigned && (tab === "new_pool" || tab === "all")

  return (
    <tr onClick={() => onOpen(lead.id)}
      className={cn(
        "group border-b border-slate-100 cursor-pointer transition-colors",
        isNew
          ? "bg-indigo-50/50 hover:bg-indigo-100/60"
          : isOdd
            ? "bg-slate-50/60 hover:bg-indigo-50/40"
            : "bg-white hover:bg-indigo-50/40"
      )}>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          {/* New indicator */}
          {isNew && <div className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />}
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold",
            isHidden ? "bg-slate-100 text-slate-400" : isNew ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700"
          )}>{ini}</div>
          <div className="min-w-0">
            <p className={cn("text-[13px] font-semibold truncate", isHidden ? "text-slate-400" : "text-slate-900")}>
              {lead.title}
            </p>
          </div>
          {isHidden && <EyeOff className="h-3.5 w-3.5 text-slate-300 shrink-0" />}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold",
          STATUS_CHIP[lead.status] ?? "bg-slate-50 text-slate-600 border-slate-100")}>
          {STATUS_LABEL[lead.status] ?? lead.status}
        </span>
      </td>
      <td className="px-4 py-3.5 hidden md:table-cell">
        {(scoringMode === "score" || scoringMode === "both")
          ? <ScoreBadge score={lead.score} />
          : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <SourceBadge source={lead.source} sources={sources} />
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        {(contactName || phone) ? (
          <div className="flex flex-col gap-0.5">
            {contactName && <span className="text-[12px] font-medium text-slate-700">{contactName}</span>}
            {phone && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <Phone className="h-2.5 w-2.5 text-slate-400" />{phone}
              </span>
            )}
          </div>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3.5 hidden xl:table-cell text-[12px] text-slate-500">
        {lead.district
          ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{lead.district}</span>
          : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        {lead.assignee ? (
          <span className="text-[12px] text-slate-600">
            {lead.assignee.profile?.full_name ?? lead.assignee.email ?? "Agent"}
          </span>
        ) : showPick ? (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onPick(lead.id) }}
            className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700 transition-colors">
            Pick
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3.5 hidden xl:table-cell text-[11px] text-slate-400">
        {relTime(lead.updated_at)}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1">
          <div className="relative">
            <LeadMenu lead={lead} menuOpenId={menuOpenId}
              onMenuToggle={onMenuToggle} onDelete={onDelete} onHide={onHide} onAddToPipeline={onAddToPipeline} />
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
        </div>
      </td>
    </tr>
  )
}

// ---- follow-up row ----

const FU_STATUS_CHIP: Record<string, string> = {
  pending:   "bg-amber-50 text-amber-700 border-amber-200",
  done:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  missed:    "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
}

function FollowUpRow({ item, index, onNavigate }: {
  item: FollowUp; index: number; onNavigate: (id: string) => void
}) {
  const isOdd = index % 2 !== 0
  const overdue = item.status === "pending" && isPast(item.due_at)

  return (
    <tr
      onClick={() => item.lead && onNavigate(item.lead.id)}
      className={cn(
        "group border-b border-slate-100 transition-colors",
        item.lead ? "cursor-pointer" : "",
        overdue
          ? "bg-rose-50/40 hover:bg-rose-50/70"
          : isOdd ? "bg-slate-50/60 hover:bg-amber-50/40" : "bg-white hover:bg-amber-50/40"
      )}>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            overdue ? "bg-rose-100" : "bg-amber-50")}>
            <Bell className={cn("h-3.5 w-3.5", overdue ? "text-rose-500" : "text-amber-500")} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">
              {item.lead?.title ?? item.contact?.name ?? "—"}
            </p>
            {item.note && <p className="text-[11px] text-slate-400 truncate">{item.note}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold",
          FU_STATUS_CHIP[item.status] ?? "bg-slate-50 text-slate-600 border-slate-200")}>
          {item.status}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <span className={cn("flex items-center gap-1 text-[12px]",
          overdue ? "font-semibold text-rose-600" : "text-slate-600")}>
          <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
          {fmtDate(item.due_at)}
          {overdue && <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">OVERDUE</span>}
        </span>
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell text-[12px] text-slate-500">
        {item.assignee?.profile?.full_name ?? item.assignee?.email ?? "—"}
      </td>
    </tr>
  )
}

// ---- task row ----

const TASK_PRIORITY: Record<string, string> = {
  urgent: "bg-rose-50 text-rose-700 border-rose-200",
  high:   "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low:    "bg-slate-50 text-slate-600 border-slate-200",
}

function TaskRow({ item, index, onNavigate }: {
  item: Task; index: number; onNavigate: (id: string) => void
}) {
  const isOdd = index % 2 !== 0
  const overdue = item.status !== "done" && !!item.due_date && isPast(item.due_date)

  return (
    <tr
      onClick={() => item.lead && onNavigate(item.lead.id)}
      className={cn(
        "group border-b border-slate-100 transition-colors",
        item.lead ? "cursor-pointer" : "",
        overdue
          ? "bg-rose-50/40 hover:bg-rose-50/70"
          : isOdd ? "bg-slate-50/60 hover:bg-violet-50/40" : "bg-white hover:bg-violet-50/40"
      )}>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            item.status === "done" ? "bg-emerald-50" : "bg-violet-50")}>
            <CheckSquare className={cn("h-3.5 w-3.5",
              item.status === "done" ? "text-emerald-500" : "text-violet-500")} />
          </div>
          <div className="min-w-0">
            <p className={cn("text-[13px] font-semibold truncate",
              item.status === "done" ? "line-through text-slate-400" : "text-slate-800")}>
              {item.title}
            </p>
            {item.lead && <p className="text-[11px] text-slate-400 truncate">{item.lead.title}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold",
          TASK_PRIORITY[item.priority] ?? "bg-slate-50 text-slate-600 border-slate-200")}>
          {item.priority}
        </span>
      </td>
      <td className="px-4 py-3.5">
        {item.due_date ? (
          <span className={cn("flex items-center gap-1 text-[12px]",
            overdue ? "font-semibold text-rose-600" : "text-slate-600")}>
            <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
            {fmtDate(item.due_date)}
            {overdue && <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">OVERDUE</span>}
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
          item.status === "done" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200")}>
          {item.status}
        </span>
      </td>
      <td className="px-4 py-3.5 hidden xl:table-cell text-[12px] text-slate-500">
        {item.assignee?.profile?.full_name ?? item.assignee?.email ?? "—"}
      </td>
    </tr>
  )
}

// ---- skeletons ----

function SkeletonTile() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden animate-pulse">
      <div className="h-1 bg-slate-100" />
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-2xl bg-slate-100 shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-3/4 rounded-lg bg-slate-100" />
            <div className="h-3 w-1/2 rounded-lg bg-slate-100" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-full bg-slate-100" />
          <div className="h-6 w-14 rounded-full bg-slate-100" />
        </div>
        <div className="h-9 rounded-xl bg-slate-100" />
        <div className="flex justify-between pt-1 border-t border-slate-100">
          <div className="h-4 w-24 rounded bg-slate-100" />
          <div className="h-4 w-16 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

function SkeletonRow({ cols = 8 }: { cols?: number }) {
  return (
    <tr className="border-b border-slate-100 animate-pulse">
      <td className="px-5 py-3.5"><div className="flex gap-3 items-center"><div className="h-9 w-9 rounded-xl bg-slate-100 shrink-0" /><div className="h-4 w-32 rounded bg-slate-100" /></div></td>
      <td className="px-4 py-3.5"><div className="h-5 w-20 rounded-full bg-slate-100" /></td>
      {cols > 2 && <><td className="px-4 py-3.5 hidden md:table-cell"><div className="h-4 w-14 rounded bg-slate-100" /></td><td className="px-4 py-3.5 hidden lg:table-cell"><div className="h-4 w-28 rounded bg-slate-100" /></td></>}
      {cols > 4 && <><td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-4 w-20 rounded bg-slate-100" /></td><td className="px-4 py-3.5 hidden lg:table-cell"><div className="h-4 w-20 rounded bg-slate-100" /></td></>}
      {cols > 6 && <><td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-4 w-12 rounded bg-slate-100" /></td><td className="px-4 py-3.5" /></>}
    </tr>
  )
}

// ---- page ----

export default function LeadsV2() {
  const router = useRouter()
  const { canViewAllLeads } = useAuth()
  const [tab, setTab] = useState("all")
  const [leads, setLeads] = useState<Lead[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [activeTagId, setActiveTagId] = useState("")
  const [search, setSearch] = useState("")
  const [searchQ, setSearchQ] = useState("")
  const [scoringMode, setScoringMode] = useState("score")
  const [scoreOptions, setScoreOptions] = useState<{ icon: string; label: string }[]>([
    { icon: "🔥", label: "Hot" }, { icon: "🌡️", label: "Warm" }, { icon: "❄️", label: "Cold" },
  ])
  const [sourceOptions, setSourceOptions] = useState<{ icon: string; label: string }[]>([
    { icon: "", label: "WhatsApp" }, { icon: "", label: "Instagram" },
    { icon: "🌐", label: "Website" }, { icon: "📣", label: "Campaign" },
    { icon: "🔗", label: "Referral" }, { icon: "👤", label: "Manual" }, { icon: "📝", label: "Other" },
  ])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"tiles" | "table">("table")
  const [createOpen, setCreateOpen] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pipelineLead, setPipelineLead] = useState<Lead | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLeadTab = !["follow_ups", "tasks"].includes(tab)

  const effectiveTab = (!canViewAllLeads && tab === "all") ? "new_pool" : tab

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === "follow_ups") {
        const r = await fetch("/api/follow-ups?limit=100").then((x) => x.json())
        setFollowUps(r.followUps ?? r ?? [])
      } else if (tab === "tasks") {
        const r = await fetch("/api/tasks?limit=100").then((x) => x.json())
        setTasks(r.tasks ?? r ?? [])
      } else {
        const params = new URLSearchParams({ tab: effectiveTab })
        if (activeTagId) params.set("tag_id", activeTagId)
        if (searchQ) params.set("q", searchQ)
        const [lr, tr, sr] = await Promise.all([
          fetch(`/api/leads?${params}`).then((r) => r.json()),
          fetch("/api/tags").then((r) => r.json()),
          fetch("/api/leads/settings").then((r) => r.json()),
        ])
        setLeads(lr.leads ?? lr ?? [])
        setTags(tr?.tags ?? tr ?? [])
        setScoringMode(sr.scoring_mode ?? "score")
        if (Array.isArray(sr.score_options) && sr.score_options.length > 0) {
          setScoreOptions(sr.score_options.map((v: unknown) =>
            typeof v === "string" ? { icon: "", label: v } : v as { icon: string; label: string }
          ))
        }
        if (Array.isArray(sr.lead_sources) && sr.lead_sources.length > 0) {
          setSourceOptions(sr.lead_sources.map((v: unknown) =>
            typeof v === "string" ? { icon: "", label: v } : v as { icon: string; label: string }
          ))
        }
      }
    } catch {
      toast.error("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [tab, effectiveTab, activeTagId, searchQ])

  useEffect(() => { loadData() }, [loadData])

  // Real-time: update the leads list instantly when any lead is patched
  useRealtime({
    channelName: "leads-list-realtime",
    onLeadEvent: useCallback((event) => {
      if (event.eventType === "UPDATE") {
        setLeads((prev) =>
          prev.map((l) => l.id === event.new.id ? { ...l, ...event.new } : l)
        )
      } else if (event.eventType === "INSERT") {
        // Reload to get the new lead with all includes (contact, assignee)
        loadData()
      }
    }, [loadData]),
  })

  function handleSearchChange(v: string) {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearchQ(v), 350)
  }

  async function handlePick(id: string) {
    try {
      await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: true }),
      })
      toast.success("Lead claimed!")
      loadData()
    } catch {
      toast.error("Failed to claim lead")
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
      toast.success("Lead deleted")
      setDeleteId(null)
      loadData()
    } catch {
      toast.error("Failed to delete lead")
    } finally {
      setDeleting(false)
    }
  }

  async function handleHide(id: string, hide: boolean) {
    try {
      await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_hidden: hide }),
      })
      toast.success(hide ? "Lead hidden from agents" : "Lead visible to agents")
      loadData()
    } catch {
      toast.error("Failed to update lead visibility")
    }
  }

  const visibleTabs = canViewAllLeads
    ? TABS
    : TABS.filter((t) => t.key !== "all")

  const listCount = isLeadTab ? leads.length : tab === "follow_ups" ? followUps.length : tasks.length

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Leads</h1>
              <p className="text-[11px] text-slate-500">
                {loading ? "Loading…" : `${listCount} ${tab === "follow_ups" ? "follow-up" : tab === "tasks" ? "task" : "lead"}${listCount !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={loadData}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="Refresh">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button type="button" onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Lead
            </button>
          </div>
        </div>

        {/* Tab menu */}
        <div className="mt-4">
          <div className="flex overflow-x-auto scrollbar-hide">
            {visibleTabs.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={cn(
                  "relative shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-all whitespace-nowrap border-b-2",
                  tab === t.key
                    ? "border-indigo-600 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300",
                )}>
                <span className={cn("h-2 w-2 rounded-full shrink-0", TAB_DOT[t.key] ?? "bg-slate-400")} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters bar — only for lead tabs */}
      {isLeadTab && (
        <div className="border-b border-slate-100 bg-white px-6 py-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-colors"
              placeholder="Search leads…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1">
            {tags.length > 0 && (
              <>
                <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {tags.map((tag) => (
                  <button key={tag.id} type="button"
                    onClick={() => setActiveTagId((prev) => prev === tag.id ? "" : tag.id)}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border",
                      activeTagId === tag.id
                        ? "bg-slate-800 text-white border-slate-800"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                    )}
                    style={activeTagId !== tag.id ? { borderColor: tag.color + "40", color: tag.color } : {}}>
                    {tag.name}
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 shrink-0">
            <button type="button" onClick={() => setView("tiles")} title="Tile view"
              className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                view === "tiles" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setView("table")} title="Table view"
              className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                view === "table" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              <Table2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Lead list */}
      <div className={cn(isLeadTab && view === "tiles" ? "p-6" : "")} onClick={() => setMenuOpenId(null)}>

        {/* â”€â”€ Follow-ups tab â”€â”€ */}
        {tab === "follow_ups" && (
          loading ? (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3 text-left">Follow-up</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Assignee</th>
              </tr></thead>
              <tbody>{[...Array(6)].map((_, i) => <SkeletonRow key={i} cols={4} />)}</tbody>
            </table>
          ) : followUps.length === 0 ? (
            <EmptyState icon={<Bell className="h-8 w-8 text-amber-300" />} title="No follow-ups" desc="Follow-ups linked to leads will appear here" />
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-3 text-left">Follow-up</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Assignee</th>
                </tr>
              </thead>
              <tbody>
                {followUps.map((fu, i) => (
                  <FollowUpRow key={fu.id} item={fu} index={i}
                    onNavigate={(id) => router.push(`/leads/${id}`)} />
                ))}
              </tbody>
            </table>
          )
        )}

        {/* â”€â”€ Tasks tab â”€â”€ */}
        {tab === "tasks" && (
          loading ? (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3 text-left">Task</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Status</th>
                <th className="px-4 py-3 text-left hidden xl:table-cell">Assignee</th>
              </tr></thead>
              <tbody>{[...Array(6)].map((_, i) => <SkeletonRow key={i} cols={5} />)}</tbody>
            </table>
          ) : tasks.length === 0 ? (
            <EmptyState icon={<CheckSquare className="h-8 w-8 text-violet-300" />} title="No tasks" desc="Tasks linked to leads will appear here" />
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-3 text-left">Task</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Status</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">Assignee</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <TaskRow key={t.id} item={t} index={i}
                    onNavigate={(id) => router.push(`/leads/${id}`)} />
                ))}
              </tbody>
            </table>
          )
        )}

        {/* â”€â”€ Lead tabs â”€â”€ */}
        {isLeadTab && (
          loading ? (
            view === "tiles" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[...Array(6)].map((_, i) => <SkeletonTile key={i} />)}
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-3 text-left">Lead</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Score</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Source</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Contact</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">District</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Assignee</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">Updated</th>
                  <th className="px-4 py-3" />
                </tr></thead>
                <tbody>{[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}</tbody>
              </table>
            )
          ) : leads.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-8 w-8 text-indigo-300" />}
              title="No leads found"
              desc={searchQ ? "Try a different search term" : "Create your first lead to get started"}
              action={!searchQ ? (
                <button type="button" onClick={() => setCreateOpen(true)}
                  className="mt-5 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200">
                  <Plus className="h-4 w-4" /> Create Lead
                </button>
              ) : undefined}
            />
          ) : view === "tiles" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {leads.map((lead) => (
                <LeadTile key={lead.id} lead={lead} tab={effectiveTab} scoringMode={scoringMode}
                  menuOpenId={menuOpenId} sources={sourceOptions}
                  onPick={handlePick}
                  onOpen={(id) => router.push(`/leads/${id}?from=${effectiveTab}`)}
                  onMenuToggle={(id) => setMenuOpenId((prev) => prev === id ? null : id)}
                  onDelete={(id) => setDeleteId(id)}
                  onHide={handleHide}
                  onAddToPipeline={(l) => setPipelineLead(l)}
                />
              ))}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-3 text-left">Lead</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Score</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Source</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Contact</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">District</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Assignee</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <LeadRow key={lead.id} lead={lead} index={i} tab={effectiveTab} scoringMode={scoringMode}
                    menuOpenId={menuOpenId} sources={sourceOptions}
                    onPick={handlePick}
                    onOpen={(id) => router.push(`/leads/${id}?from=${effectiveTab}`)}
                    onMenuToggle={(id) => setMenuOpenId((prev) => prev === id ? null : id)}
                    onDelete={(id) => setDeleteId(id)}
                    onHide={handleHide}
                    onAddToPipeline={(l) => setPipelineLead(l)}
                  />
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      <CreateLeadDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={loadData}
        scoringMode={scoringMode}
        scoreOptions={scoreOptions}
        sourceOptions={sourceOptions}
      />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Lead"
        description="This lead and all its activity history will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      {pipelineLead && (
        <AddToPipelineModal lead={pipelineLead} onClose={() => setPipelineLead(null)} />
      )}
    </div>
  )
}

// ---- Add to Pipeline modal ----

interface PipelineOption { id: string; name: string; stages: { id: string; name: string }[] }

function AddToPipelineModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState("")
  const [selectedStageId, setSelectedStageId] = useState("")
  const [title, setTitle] = useState(lead.title)
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/pipelines")
      .then((r) => r.json())
      .then((d) => {
        const list: PipelineOption[] = d.pipelines ?? []
        setPipelines(list)
        if (list.length > 0) {
          setSelectedPipelineId(list[0].id)
          setSelectedStageId(list[0].stages[0]?.id ?? "")
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPipelineId || !selectedStageId) { toast.error("Select a pipeline and stage"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_id: selectedPipelineId,
          stage_id:    selectedStageId,
          lead_id:     lead.id,
          contact_id:  lead.contact?.id ?? null,
          title:       title.trim() || lead.title,
          value:       parseFloat(value) || 0,
        }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Deal added to pipeline")
      onClose()
    } catch {
      toast.error("Failed to add to pipeline")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">Add to Pipeline</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 truncate max-w-[280px]">{lead.title}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : pipelines.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-slate-500">
            No pipelines yet.{" "}
            <a href="/pipelines" className="text-indigo-600 hover:underline">Create one first →</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Deal Title</label>
              <input
                value={title} onChange={(e) => setTitle(e.target.value)} required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Pipeline</label>
                <select
                  value={selectedPipelineId}
                  onChange={(e) => {
                    setSelectedPipelineId(e.target.value)
                    const p = pipelines.find((p) => p.id === e.target.value)
                    setSelectedStageId(p?.stages[0]?.id ?? "")
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Stage</label>
                <select
                  value={selectedStageId} onChange={(e) => setSelectedStageId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {(selectedPipeline?.stages ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Deal Value (optional)</label>
              <input
                type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {saving && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                Add to Pipeline
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function EmptyState({ icon, title, desc, action }: {
  icon: React.ReactNode; title: string; desc: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 mb-4">{icon}</div>
      <p className="text-[15px] font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-[13px] text-slate-400">{desc}</p>
      {action}
    </div>
  )
}
