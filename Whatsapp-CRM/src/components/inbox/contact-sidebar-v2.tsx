"use client"

import { useState, useEffect, useCallback } from "react"
import type { Contact, ContactNote, Tag } from "@/types"
import { Phone, Copy, Check, Plus, ExternalLink, Tag as TagIcon, FileText, X, User, Mail, MessageSquare, Radio, Search } from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

// Matches the role labels used everywhere else in the app (Settings →
// Members, sidebar role badge) — "Supervisor" is this app's name for the
// manager-level role, so notes show that instead of the raw enum value.
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  supervisor: "Supervisor",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
}

interface Props {
  contact: Contact | null
  channel?: string // 'whatsapp' | 'instagram' | 'facebook' | 'sms' | 'email' | 'rcs'
}

const AVATAR_GRADIENTS = [
  "from-indigo-500 to-indigo-700",
  "from-violet-500 to-violet-700",
  "from-emerald-500 to-emerald-700",
  "from-sky-500 to-sky-700",
  "from-rose-500 to-rose-700",
  "from-amber-500 to-amber-700",
]
function avatarGrad(id: string) {
  const s = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_GRADIENTS[s % AVATAR_GRADIENTS.length]
}

// Same palette used for Segments — keeps tags created from the inbox
// visually consistent with tags created elsewhere in the app.
const TAG_COLOR_PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#f43f5e",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6",
]
function colorForNewTag(name: string) {
  const s = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return TAG_COLOR_PALETTE[s % TAG_COLOR_PALETTE.length]
}

export function ContactSidebarV2({ contact, channel = "whatsapp" }: Props) {
  const [copied, setCopied] = useState(false)
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newNote, setNewNote] = useState("")
  const [addingNote, setAddingNote] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState("")
  const [tagBusyId, setTagBusyId] = useState<string | null>(null)

  const fetchContactData = useCallback(async () => {
    if (!contact) return
    try {
      const [contactRes, tagsRes] = await Promise.all([
        fetch(`/api/contacts/${contact.id}`),
        fetch(`/api/tags`),
      ])
      if (contactRes.ok) {
        const body = await contactRes.json()
        if (body.notes) setNotes(body.notes)
        if (body.tags) setTags(body.tags)
      }
      if (tagsRes.ok) {
        const body = await tagsRes.json()
        if (body.tags) setAllTags(body.tags)
      }
    } catch { }
  }, [contact])

  useEffect(() => { fetchContactData() }, [fetchContactData])
  // Reset the picker's search when switching between contacts/conversations.
  useEffect(() => { setTagPickerOpen(false); setTagQuery("") }, [contact?.id])

  const attachedTagIds = new Set(tags.map((t) => t.id))
  const matchingTags = allTags.filter(
    (t) => !attachedTagIds.has(t.id) && t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()),
  )
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === tagQuery.trim().toLowerCase())

  const handleAttachTag = useCallback(async (tagId: string) => {
    if (!contact) return
    setTagBusyId(tagId)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag_id: tagId }),
      })
      if (res.ok) {
        const tag = allTags.find((t) => t.id === tagId)
        if (tag) setTags((prev) => [...prev, { ...tag, contact_tag_id: tagId }])
        setTagQuery("")
      } else {
        toast.error("Failed to add tag")
      }
    } catch { toast.error("Failed to add tag") }
    finally { setTagBusyId(null) }
  }, [contact, allTags])

  const handleCreateAndAttachTag = useCallback(async () => {
    const name = tagQuery.trim()
    if (!contact || !name) return
    setTagBusyId("__new__")
    try {
      const createRes = await fetch(`/api/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color: colorForNewTag(name) }),
      })
      if (!createRes.ok) { toast.error("Failed to create tag"); return }
      const { tag } = await createRes.json()
      const attachRes = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      })
      if (attachRes.ok) {
        setAllTags((prev) => [...prev, tag])
        setTags((prev) => [...prev, { ...tag, contact_tag_id: tag.id }])
        setTagQuery("")
        toast.success("Tag created")
      } else {
        toast.error("Failed to add tag")
      }
    } catch { toast.error("Failed to create tag") }
    finally { setTagBusyId(null) }
  }, [contact, tagQuery])

  const handleRemoveTag = useCallback(async (tagId: string) => {
    if (!contact) return
    setTagBusyId(tagId)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags?tag_id=${encodeURIComponent(tagId)}`, { method: "DELETE" })
      if (res.ok) setTags((prev) => prev.filter((t) => t.id !== tagId))
      else toast.error("Failed to remove tag")
    } catch { toast.error("Failed to remove tag") }
    finally { setTagBusyId(null) }
  }, [contact])

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone || contact.phone.startsWith("email:")) return
    await navigator.clipboard.writeText(contact.phone)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [contact])

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return
    setAddingNote(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note_text: newNote.trim() }),
      })
      if (res.ok) {
        const body = await res.json()
        if (body.note) setNotes((prev) => [body.note, ...prev])
        setNewNote("")
        setNoteOpen(false)
        toast.success("Note added")
      }
    } catch { toast.error("Failed to add note") }
    finally { setAddingNote(false) }
  }, [contact, newNote])

  if (!contact) {
    return (
      <div className="flex h-full w-[300px] flex-col items-center justify-center bg-slate-50/60 border-l border-slate-100">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm mb-4">
          <User className="h-7 w-7 text-slate-300" />
        </div>
        <p className="text-[13px] font-semibold text-slate-500">No conversation selected</p>
        <p className="mt-1 text-[12px] text-slate-400">Contact details appear here</p>
      </div>
    )
  }

  // Email-only contacts (created from an inbound email with no phone number)
  // get a "email:<address>" placeholder in contact.phone — Contact.phone has
  // no NULL option in the schema. Treat that placeholder as "no real phone"
  // everywhere in this component rather than showing it as if it were one.
  const hasRealPhone = Boolean(contact.phone) && !contact.phone.startsWith("email:")

  const displayName = contact.name || (hasRealPhone ? contact.phone : contact.email) || "Unknown"
  const ini = (displayName || "?").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
  const grad = avatarGrad(contact.id)

  const infoRows: { label: string; value: string; isPhone?: boolean }[] = []
  if (hasRealPhone) infoRows.push({ label: "Phone", value: contact.phone, isPhone: true })
  if (contact.email) infoRows.push({ label: "Email", value: contact.email })
  if (contact.company) infoRows.push({ label: "Company", value: contact.company })
  if ((contact as unknown as Record<string, unknown>).location) {
    infoRows.push({ label: "Location", value: String((contact as unknown as Record<string, unknown>).location) })
  }
  if (contact.created_at) infoRows.push({ label: "Added", value: format(new Date(contact.created_at), "d MMM yyyy") })

  return (
    <div className="flex h-full w-[300px] flex-col bg-white border-l border-slate-100">
      {/* Avatar + name */}
      <div className="shrink-0 flex flex-col items-center px-5 pt-7 pb-5 border-b border-slate-100">
        <div className="relative">
          {contact.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.avatar_url} alt={displayName}
              className="h-20 w-20 rounded-2xl object-cover ring-4 ring-white shadow-lg" />
          ) : (
            <div className={cn("flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br text-white text-2xl font-black shadow-lg ring-4 ring-white", grad)}>
              {ini}
            </div>
          )}
          {/* Channel badge */}
          {channel === "instagram" ? (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full shadow-md ring-2 ring-white overflow-hidden">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
                <defs>
                  <radialGradient id="ig-sb" cx="30%" cy="107%" r="150%">
                    <stop offset="0%" stopColor="#fdf497" />
                    <stop offset="45%" stopColor="#fd5949" />
                    <stop offset="60%" stopColor="#d6249f" />
                    <stop offset="90%" stopColor="#285AEB" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width="24" height="24" rx="6" fill="url(#ig-sb)" />
                <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2" fill="none" />
                <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
              </svg>
            </span>
          ) : channel === "facebook" ? (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#1877F2] shadow-md ring-2 ring-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.885v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
            </span>
          ) : channel === "sms" ? (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500 shadow-md ring-2 ring-white">
              <MessageSquare className="h-3.5 w-3.5 text-white" />
            </span>
          ) : channel === "email" ? (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 shadow-md ring-2 ring-white">
              <Mail className="h-3.5 w-3.5 text-white" />
            </span>
          ) : channel === "rcs" ? (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-violet-500 shadow-md ring-2 ring-white">
              <Radio className="h-3.5 w-3.5 text-white" />
            </span>
          ) : (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#25d366] shadow-md ring-2 ring-white">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.997 2.003A9.995 9.995 0 0 0 2 12c0 1.751.455 3.395 1.249 4.83L2 22l5.33-1.218A9.968 9.968 0 0 0 12 22c5.514 0 10-4.486 10-10S17.514 2 12 2h-.003zm5.884 14.211c-.246.688-1.228 1.264-1.721 1.345-.451.075-.999.108-1.611-.104-.373-.128-.851-.297-1.463-.574-2.576-1.114-4.26-3.699-4.389-3.871-.124-.164-1.013-1.345-1.013-2.567 0-1.222.641-1.823.869-2.072.228-.248.497-.31.662-.31.166 0 .33.002.476.01.153.008.358-.058.56.428.208.503.707 1.735.768 1.86.061.126.102.273.02.44-.083.166-.124.272-.248.418-.124.148-.261.329-.372.441-.124.124-.253.259-.109.509.145.248.641 1.057 1.376 1.712.944.84 1.739 1.099 1.987 1.223.248.124.394.103.539-.063.145-.166.622-.726.789-.973.165-.248.33-.207.557-.124.228.083 1.44.679 1.686.803.248.124.414.185.475.289.062.103.062.597-.184 1.38z"/></svg>
            </span>
          )}
        </div>
        <h3 className="mt-4 text-[16px] font-bold text-slate-900 text-center">{displayName}</h3>
        {contact.company && (
          <p className="mt-0.5 text-[12px] text-slate-500">{contact.company}</p>
        )}

        {/* Quick actions */}
        <div className="mt-4 flex items-center gap-2 w-full">
          {hasRealPhone ? (
            <>
              <a href={`tel:${contact.phone}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-[12px] font-semibold text-white hover:bg-emerald-600 transition-colors">
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
              <button type="button" onClick={handleCopyPhone}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </>
          ) : contact.email ? (
            <a href={`mailto:${contact.email}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-500 py-2 text-[12px] font-semibold text-white hover:bg-sky-600 transition-colors">
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          ) : null}
          <a href={`/contacts?open=${contact.id}`}
            title="Edit contact"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Scrollable info area */}
      <div className="flex-1 overflow-y-auto scroll-styled">

        {/* Info rows */}
        {infoRows.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Contact Info</p>
            <div className="space-y-2">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 shrink-0 w-16">{row.label}</span>
                  {row.isPhone ? (
                    <button type="button" onClick={handleCopyPhone}
                      className="flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 min-w-0 truncate transition-colors">
                      <span className="truncate">{row.value}</span>
                      {copied
                        ? <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                        : <Copy className="h-3 w-3 shrink-0 text-slate-400" />}
                    </button>
                  ) : (
                    <span className="text-[13px] font-medium text-slate-800 truncate">{row.value}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <TagIcon className="h-3 w-3 text-slate-400" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tags</p>
            </div>
            <button type="button" onClick={() => setTagPickerOpen((v) => !v)}
              className={cn("flex h-6 w-6 items-center justify-center rounded-lg transition-all",
                tagPickerOpen ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
              {tagPickerOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>

          {tags.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No tags</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t.contact_tag_id}
                  className="group/tag flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-[11px] font-semibold"
                  style={{ background: t.color + "20", color: t.color }}>
                  {t.name}
                  <button type="button" onClick={() => handleRemoveTag(t.id)} disabled={tagBusyId === t.id}
                    aria-label={`Remove ${t.name} tag`}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/tag:opacity-100 hover:bg-black/10 disabled:opacity-50">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {tagPickerOpen && (
            <div className="mt-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input value={tagQuery} onChange={(e) => setTagQuery(e.target.value)}
                  placeholder="Search or create a tag…" autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagQuery.trim() && !exactMatch && matchingTags.length === 0) {
                      handleCreateAndAttachTag()
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors" />
              </div>

              <div className="max-h-40 overflow-y-auto space-y-1 scroll-styled">
                {matchingTags.map((t) => (
                  <button key={t.id} type="button" onClick={() => handleAttachTag(t.id)} disabled={tagBusyId === t.id}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-white transition-colors disabled:opacity-50">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}

                {tagQuery.trim() && !exactMatch && (
                  <button type="button" onClick={handleCreateAndAttachTag} disabled={tagBusyId === "__new__"}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-indigo-600 hover:bg-white transition-colors disabled:opacity-50">
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {tagBusyId === "__new__" ? "Creating…" : `Create "${tagQuery.trim()}"`}
                    </span>
                  </button>
                )}

                {!tagQuery.trim() && matchingTags.length === 0 && (
                  <p className="px-2 py-1.5 text-[12px] text-slate-400 italic">All tags already added</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-slate-400" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Notes</p>
            </div>
            <button type="button" onClick={() => setNoteOpen((v) => !v)}
              className={cn("flex h-6 w-6 items-center justify-center rounded-lg transition-all",
                noteOpen ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
              {noteOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>

          {noteOpen && (
            <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
              <textarea rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)}
                placeholder="Write a note…" autoFocus
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-colors" />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setNoteOpen(false); setNewNote("") }} disabled={addingNote}
                  className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={handleAddNote} disabled={addingNote || !newNote.trim()}
                  className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50">
                  {addingNote ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No notes yet</p>
          ) : (
            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                  <p className="text-[12px] text-slate-700 leading-relaxed">{note.note_text}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-600">
                    {note.created_by_name && (
                      <span className="font-semibold text-amber-700">{note.created_by_name}</span>
                    )}
                    {note.created_by_role && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                        {ROLE_LABELS[note.created_by_role] ?? note.created_by_role}
                      </span>
                    )}
                    <span>{note.created_at ? format(new Date(note.created_at), "d MMM, h:mm a") : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
