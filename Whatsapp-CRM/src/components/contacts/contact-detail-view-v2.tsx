"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { Contact, Tag, ContactNote, CustomField } from "@/types"
import {
  X, Phone, Mail, Building2, Copy, Check, Plus, Trash2,
  Save, MessageSquare, Tag as TagIcon, FileText, Sliders,
  User, ChevronRight, TrendingUp, Flame, Thermometer, Snowflake,
  ExternalLink, Clock,
} from "lucide-react"
import { format } from "date-fns"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const GRADIENTS = [
  "from-indigo-400 to-indigo-600",
  "from-emerald-400 to-emerald-600",
  "from-violet-400 to-violet-600",
  "from-sky-400 to-sky-600",
  "from-amber-400 to-amber-600",
  "from-rose-400 to-rose-600",
]
function avatarGrad(id: string) {
  const s = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return GRADIENTS[s % GRADIENTS.length]
}
function initials(name?: string | null, phone?: string) {
  if (name) return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
  return phone ? phone.slice(-2) : "?"
}

type Tab = "details" | "leads" | "tags" | "notes" | "custom"

interface LeadSummary {
  id: string; title: string; status: string; score: string
  source: string; created_at: string; converted_at: string | null
  assigned_to: string | null
  assignee?: { id: string; email: string; profile?: { full_name?: string | null } | null } | null
  activities?: { created_at: string }[]
  _count?: { follow_ups: number; activities: number }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string | null
  onUpdated: () => void
}

function FieldInput({ label, value, onChange, required, type = "text", placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  type?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500 text-[10px]">required</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-3 focus:ring-indigo-100 outline-none transition-all shadow-sm"
      />
    </div>
  )
}

export function ContactDetailViewV2({ open, onOpenChange, contactId, onUpdated }: Props) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>("details")
  const [copied, setCopied] = useState(false)

  // Details
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [alternatePhone, setAlternatePhone] = useState("")
  const [email, setEmail] = useState("")
  const [company, setCompany] = useState("")
  const [gender, setGender] = useState("")
  const [saving, setSaving] = useState(false)

  // Tags
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [savingTag, setSavingTag] = useState(false)

  // Notes
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [noteText, setNoteText] = useState("")
  const [savingNote, setSavingNote] = useState(false)

  // Custom fields
  const [fields, setFields] = useState<CustomField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [savingCustom, setSavingCustom] = useState(false)

  // Leads tab
  const [leads, setLeads] = useState<LeadSummary[]>([])
  const [leadCounts, setLeadCounts] = useState({ total: 0, active: 0, closed: 0 })
  const [leadsLoading, setLeadsLoading] = useState(false)

  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    setTab("details")
    try {
      const [cr, tr, nr, cvr] = await Promise.all([
        fetch(`/api/contacts/${contactId}`).then((r) => r.json()),
        fetch("/api/tags").then((r) => r.json()),
        fetch(`/api/contacts/${contactId}/notes`).then((r) => r.json()),
        fetch(`/api/contacts/${contactId}/custom-values`).then((r) => r.json()),
      ])
      const c: Contact = cr.contact
      if (c) {
        setContact(c)
        setName(c.name ?? "")
        setPhone(c.phone ?? "")
        setAlternatePhone(c.alternate_phone ?? "")
        setEmail(c.email ?? "")
        setCompany(c.company ?? "")
        setGender(c.gender ?? "")
      }
      setAllTags(tr?.tags ?? [])
      const ctags: { tag_id?: string; id?: string }[] = cr.tags ?? []
      setTagIds(ctags.map((t) => t.tag_id ?? t.id ?? "").filter(Boolean))
      setNotes(nr.notes ?? [])
      setFields(cvr.fields ?? [])
      const map: Record<string, string> = {}
      for (const v of (cvr.values ?? []) as { custom_field_id: string; value?: string }[]) {
        map[v.custom_field_id] = v.value ?? ""
      }
      setValues(map)
    } catch {
      toast.error("Failed to load contact")
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => { if (open && contactId) load() }, [open, contactId, load])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onOpenChange(false) }
    if (open) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  async function copyPhone() {
    if (!contact?.phone) return
    await navigator.clipboard.writeText(contact.phone)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveDetails() {
    if (!contactId || !phone.trim()) { toast.error("Phone is required"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null, phone: phone.trim(), alternate_phone: alternatePhone.trim() || null, email: email.trim() || null, company: company.trim() || null, gender: gender || null }),
      })
      if (!res.ok) { toast.error("Failed to update"); return }
      const j = await res.json()
      setContact(j.contact)
      toast.success("Contact saved")
      onUpdated()
    } finally { setSaving(false) }
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return
    setSavingTag(true)
    const has = tagIds.includes(tagId)
    try {
      if (has) {
        const res = await fetch(`/api/contacts/${contactId}/tags?tag_id=${encodeURIComponent(tagId)}`, { method: "DELETE" })
        if (res.ok) { setTagIds((p) => p.filter((id) => id !== tagId)); onUpdated() }
      } else {
        const res = await fetch(`/api/contacts/${contactId}/tags`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag_id: tagId }),
        })
        if (res.ok) { setTagIds((p) => [...p, tagId]); onUpdated() }
      }
    } finally { setSavingTag(false) }
  }

  async function addNote() {
    if (!contactId || !noteText.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note_text: noteText.trim() }),
      })
      if (!res.ok) { toast.error("Failed to add note"); return }
      const j = await res.json()
      setNotes((p) => [j.note, ...p])
      setNoteText("")
      toast.success("Note added")
    } finally { setSavingNote(false) }
  }

  async function deleteNote(noteId: string) {
    if (!contactId) return
    const res = await fetch(`/api/contacts/${contactId}/notes/${noteId}`, { method: "DELETE" })
    if (res.ok) { setNotes((p) => p.filter((n) => n.id !== noteId)); toast.success("Note deleted") }
    else toast.error("Failed to delete note")
  }

  async function loadLeads() {
    if (!contactId) return
    setLeadsLoading(true)
    try {
      const r = await fetch(`/api/contacts/${contactId}/leads`).then((x) => x.json())
      setLeads(r.leads ?? [])
      setLeadCounts(r.counts ?? { total: 0, active: 0, closed: 0 })
    } catch {
      toast.error("Failed to load leads")
    } finally {
      setLeadsLoading(false)
    }
  }

  async function saveCustom() {
    if (!contactId) return
    setSavingCustom(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/custom-values`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      })
      if (!res.ok) toast.error("Failed to save")
      else toast.success("Custom fields saved")
    } finally { setSavingCustom(false) }
  }

  if (!open) return null

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "details", label: "Details", icon: <User className="h-3.5 w-3.5" /> },
    { id: "leads",   label: "Leads",   icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { id: "tags",    label: "Tags",    icon: <TagIcon className="h-3.5 w-3.5" /> },
    { id: "notes",   label: "Notes",   icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "custom",  label: "Fields",  icon: <Sliders className="h-3.5 w-3.5" /> },
  ]

  function handleTabChange(id: Tab) {
    setTab(id)
    if (id === "leads" && leads.length === 0) loadLeads()
  }

  const displayName = contact?.name || contact?.phone || "Contact"
  const ini = initials(contact?.name, contact?.phone ?? undefined)
  const grad = contact ? avatarGrad(contact.id) : "from-slate-400 to-slate-600"

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col bg-slate-50 shadow-2xl"
        style={{ animation: "slideInRight 0.2s ease-out" }}
      >
        {loading || !contact ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="shrink-0 bg-white border-b border-slate-100">
              {/* Close + title */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Contact Details</span>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Avatar + info */}
              <div className="flex items-start gap-4 px-5 pb-4">
                <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white text-lg font-black shadow-md", grad)}>
                  {ini}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[17px] font-bold text-slate-900 truncate leading-tight">{displayName}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {contact.phone && (
                      <button
                        type="button"
                        onClick={copyPhone}
                        className="flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[12px] font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                      >
                        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        {contact.phone}
                      </button>
                    )}
                    {contact.email && (
                      <span className="flex items-center gap-1 text-[12px] text-slate-400">
                        <Mail className="h-3 w-3" />{contact.email}
                      </span>
                    )}
                  </div>
                  {contact.company && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-slate-400">
                      <Building2 className="h-3 w-3" />{contact.company}
                    </p>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex border-t border-slate-100">
                <a href={`tel:${contact.phone}`}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors border-r border-slate-100">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
                <a href="/inbox"
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors border-r border-slate-100">
                  <MessageSquare className="h-3.5 w-3.5" /> Message
                </a>
                <button type="button" onClick={copyPhone}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-t border-slate-100">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTabChange(t.id)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors border-b-2",
                      tab === t.id
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300"
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Details ── */}
              {tab === "details" && (
                <div className="p-5 space-y-4">
                  <FieldInput label="Full Name" value={name} onChange={setName} placeholder="e.g. John Doe" />
                  <FieldInput label="Phone" value={phone} onChange={setPhone} required type="tel" placeholder="+91 98765 43210" />
                  <FieldInput label="Alternate Phone" value={alternatePhone} onChange={setAlternatePhone} type="tel" placeholder="+91 98765 43210" />
                  <FieldInput label="Email" value={email} onChange={setEmail} type="email" placeholder="john@example.com" />
                  <FieldInput label="Company" value={company} onChange={setCompany} placeholder="Acme Corp" />
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Gender</label>
                    <select value={gender} onChange={(e) => setGender(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none appearance-none">
                      <option value="">Not specified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="trans">Trans</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={saveDetails}
                    disabled={saving || !phone.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}

              {/* ── Leads ── */}
              {tab === "leads" && (
                <div className="p-4 space-y-3">
                  {/* Summary counts */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-slate-100 bg-white p-3 text-center shadow-sm">
                      <p className="text-[20px] font-bold text-slate-800">{leadCounts.total}</p>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">Total</p>
                    </div>
                    <div className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-center">
                      <p className="text-[20px] font-bold text-orange-700">{leadCounts.active}</p>
                      <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mt-0.5">Active</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                      <p className="text-[20px] font-bold text-emerald-700">{leadCounts.closed}</p>
                      <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide mt-0.5">Closed</p>
                    </div>
                  </div>

                  {leadsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                    </div>
                  ) : leads.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                        <TrendingUp className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-[14px] font-semibold text-slate-700">No leads yet</p>
                      <p className="text-[12px] text-slate-400">Create a lead linked to this contact to track their enquiries.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {leads.map((lead) => {
                        const isActive = lead.status !== "closed"
                        const lastActivity = lead.activities?.[0]?.created_at ?? null
                        const agentName = lead.assignee?.profile?.full_name ?? lead.assignee?.email ?? null
                        return (
                          <div
                            key={lead.id}
                            className={cn(
                              "rounded-xl border bg-white p-3.5 shadow-sm",
                              isActive ? "border-slate-200" : "border-slate-100 opacity-75"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {lead.score === "hot"  && <Flame className="h-3 w-3 text-rose-500 shrink-0" />}
                                  {lead.score === "warm" && <Thermometer className="h-3 w-3 text-amber-500 shrink-0" />}
                                  {lead.score === "cold" && <Snowflake className="h-3 w-3 text-sky-500 shrink-0" />}
                                  <p className="text-[13px] font-semibold text-slate-800 truncate">{lead.title}</p>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                  <span className={cn(
                                    "text-[10px] font-semibold rounded-full px-2 py-0.5",
                                    lead.status === "closed" ? "bg-emerald-100 text-emerald-700"
                                    : lead.status === "follow_up" ? "bg-orange-100 text-orange-700"
                                    : lead.status === "new" ? "bg-indigo-100 text-indigo-700"
                                    : "bg-slate-100 text-slate-600"
                                  )}>
                                    {lead.status.replace(/_/g, " ")}
                                  </span>
                                  {agentName && (
                                    <span className="text-[11px] text-slate-400">{agentName}</span>
                                  )}
                                  {lastActivity && (
                                    <span className="flex items-center gap-0.5 text-[11px] text-slate-400">
                                      <Clock className="h-2.5 w-2.5" />
                                      {new Date(lastActivity).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => router.push(`/leads/${lead.id}`)}
                                className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="mt-1.5 text-[11px] text-slate-400">
                              Created {format(new Date(lead.created_at), "d MMM yyyy")}
                              {lead.converted_at ? ` · Closed ${format(new Date(lead.converted_at), "d MMM yyyy")}` : ""}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tags ── */}
              {tab === "tags" && (
                <div className="p-5">
                  {allTags.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                        <TagIcon className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-[14px] font-semibold text-slate-700">No tags yet</p>
                      <p className="text-[12px] text-slate-400">Create tags in Settings → Tags</p>
                      <a href="/settings?tab=tags"
                        className="flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:underline">
                        Go to Tags Settings <ChevronRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ) : (
                    <>
                      <p className="mb-4 text-[12px] text-slate-400">Tap a tag to add or remove it.</p>
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const on = tagIds.includes(tag.id)
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleTag(tag.id)}
                              disabled={savingTag}
                              className={cn(
                                "flex items-center gap-1.5 rounded-full border-2 px-3.5 py-1.5 text-[13px] font-semibold transition-all",
                                on
                                  ? "shadow-md scale-105"
                                  : "opacity-50 hover:opacity-80 hover:scale-105",
                              )}
                              style={on
                                ? { background: tag.color, color: "#fff", borderColor: tag.color }
                                : { background: tag.color + "15", color: tag.color, borderColor: tag.color + "40" }
                              }
                            >
                              {on && <Check className="h-3 w-3" />}
                              {tag.name}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Notes ── */}
              {tab === "notes" && (
                <div className="p-5 space-y-4">
                  {/* Add note */}
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <textarea
                      rows={3}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Write a note about this contact…"
                      className="w-full resize-none px-4 pt-3.5 pb-2 text-[14px] text-slate-800 placeholder:text-slate-300 focus:outline-none"
                    />
                    <div className="flex justify-end border-t border-slate-100 px-3 py-2">
                      <button
                        type="button"
                        onClick={addNote}
                        disabled={savingNote || !noteText.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                      >
                        {savingNote
                          ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          : <Plus className="h-3.5 w-3.5" />}
                        Add Note
                      </button>
                    </div>
                  </div>

                  {/* Notes list */}
                  {notes.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <FileText className="h-8 w-8 text-slate-200" />
                      <p className="text-[13px] text-slate-400">No notes yet. Add one above.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {notes.map((note) => (
                        <div key={note.id} className="group rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                          <div className="flex items-start gap-2">
                            <p className="flex-1 text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">{note.note_text}</p>
                            <button
                              type="button"
                              onClick={() => deleteNote(note.id)}
                              className="shrink-0 opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="mt-1.5 text-[11px] text-amber-500">
                            {note.created_at ? format(new Date(note.created_at), "d MMM yyyy, h:mm a") : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Custom Fields ── */}
              {tab === "custom" && (
                <div className="p-5">
                  {fields.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                        <Sliders className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-[14px] font-semibold text-slate-700">No custom fields</p>
                      <p className="text-[12px] text-slate-400">Define your custom fields in Settings first.</p>
                      <a href="/settings?tab=custom-fields"
                        className="flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:underline">
                        Manage Custom Fields <ChevronRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {fields.map((field) => (
                        <div key={field.id} className="space-y-1.5">
                          <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                            {field.field_name}
                            {field.field_type && (
                              <span className="ml-1.5 normal-case text-[10px] font-normal text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
                                {field.field_type}
                              </span>
                            )}
                          </label>
                          {field.field_type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={values[field.id] ?? ""}
                              onChange={(e) => setValues((p) => ({ ...p, [field.id]: e.target.value }))}
                              placeholder={`Enter ${field.field_name}…`}
                              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all shadow-sm"
                            />
                          ) : (
                            <input
                              type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                              value={values[field.id] ?? ""}
                              onChange={(e) => setValues((p) => ({ ...p, [field.id]: e.target.value }))}
                              placeholder={`Enter ${field.field_name}…`}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all shadow-sm"
                            />
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={saveCustom}
                        disabled={savingCustom}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {savingCustom
                          ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          : <Save className="h-4 w-4" />}
                        {savingCustom ? "Saving…" : "Save Custom Fields"}
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </div>

      <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </>
  )
}
