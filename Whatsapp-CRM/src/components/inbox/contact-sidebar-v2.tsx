"use client"

import { useState, useEffect, useCallback } from "react"
import type { Contact, ContactNote, Tag } from "@/types"
import { Phone, Copy, Check, Plus, ExternalLink, Tag as TagIcon, FileText, X, User, Mail, MessageSquare, Radio, Search, Globe, Sparkles } from "lucide-react"
import { isPlaceholderPhone, usablePhone } from "@/lib/contacts/validate"
import { format } from "date-fns"
import { toast } from "sonner"
import { readableTextColor } from "@/lib/readable-color"
import { TelegramIcon, WhatsAppIcon } from "@/components/icons/brand-icons"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { ChannelLinks } from "@/components/contacts/channel-links"

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
  channel?: string // 'whatsapp' | 'instagram' | 'facebook' | 'sms' | 'email' | 'rcs' | 'website' | 'telegram'
  /** The open conversation — Telegram's "Ask for number" sends in it. */
  conversationId?: string | null
  /** Switch the Inbox to another of this contact's chats (Channels). */
  onOpenConversation?: (conversationId: string) => void
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

export function ContactSidebarV2({ contact, channel = "whatsapp", conversationId = null, onOpenConversation }: Props) {
  const [copied, setCopied] = useState(false)
  const [askingNumber, setAskingNumber] = useState(false)

  // Telegram never shows a person's number; the bot asks with Telegram's
  // own "Share my number" button, and the reply fills it in.
  async function askForNumber() {
    if (!conversationId || askingNumber) return
    setAskingNumber(true)
    try {
      await apiFetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message_type: "text", content_text: "", telegram_ask_number: true }),
      })
      toast.success("Asked for their number — it appears here when they share it")
    } catch (err) {
      console.error("[contact sidebar] ask for number failed:", err)
      toast.error(errorText(err, "Could not send the request."))
    } finally {
      setAskingNumber(false)
    }
  }
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

  // What the AI made of the conversation: tags it suggests (a person
  // decides) and the ones it added — each with the customer's own words.
  type AiTag = { id: string; tag_id: string; tag_name: string; tag_color: string; evidence: string; confidence: string; reason: string | null }
  const [aiSuggestions, setAiSuggestions] = useState<AiTag[]>([])
  const [aiApplied, setAiApplied] = useState<AiTag[]>([])
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const loadAiTags = useCallback(async (id: string, isCurrent: () => boolean = () => true) => {
    try {
      const res = await fetch(`/api/contacts/${id}/ai-tags`)
      if (!res.ok) return
      const body = (await res.json()) as { suggestions?: AiTag[]; applied?: AiTag[] }
      if (!isCurrent()) return
      setAiSuggestions(Array.isArray(body.suggestions) ? body.suggestions : [])
      setAiApplied(Array.isArray(body.applied) ? body.applied : [])
    } catch (err) {
      console.warn("[contact sidebar] AI tags failed:", err)
    }
  }, [])
  async function decideAiTag(s: AiTag, action: "accept" | "dismiss") {
    if (!contact || aiBusy) return
    setAiBusy(s.id)
    try {
      await apiFetch(`/api/contacts/${contact.id}/ai-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision_id: s.id, action }),
      })
      toast.success(action === "accept" ? `Tagged ${s.tag_name}` : "Suggestion dismissed")
      await Promise.all([loadAiTags(contact.id), fetchContactData()])
    } catch (err) {
      console.error("[contact sidebar] AI tag decision failed:", err)
      toast.error(errorText(err, "Could not save."))
    } finally {
      setAiBusy(null)
    }
  }

  // Every channel this person is on — one contact, a link to each chat.
  // Re-read when the open chat changes contact (a Telegram number joining
  // a known WhatsApp contact).
  const [channelLinks, setChannelLinks] = useState<Array<{ channel: string; conversation_id: string }>>([])
  const contactId = contact?.id ?? null
  useEffect(() => {
    if (!contactId) { setChannelLinks([]); setAiSuggestions([]); setAiApplied([]); return }
    let current = true
    void loadAiTags(contactId, () => current)
    fetch(`/api/contacts/${contactId}/channels`)
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((body: { channels?: Array<{ channel: string; conversation_id: string }> }) => {
        if (current) setChannelLinks(Array.isArray(body.channels) ? body.channels : [])
      })
      .catch((err) => console.warn("[contact sidebar] channels failed:", err))
    return () => { current = false }
  }, [contactId, conversationId, loadAiTags])
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
    const phone = usablePhone(contact)
    if (!phone) return
    await navigator.clipboard.writeText(phone)
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
  const hasRealPhone = Boolean(contact.phone) && !isPlaceholderPhone(contact.phone)
  // The number to call: their own, or the one a website visitor typed in
  // (kept as the alternate — it never becomes their identity).
  const callPhone = usablePhone(contact)

  const displayName = contact.name || (hasRealPhone ? contact.phone : contact.email) || "Unknown"
  const ini = (displayName || "?").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
  const grad = avatarGrad(contact.id)

  const infoRows: { label: string; value: string; isPhone?: boolean }[] = []
  if (hasRealPhone) infoRows.push({ label: "Phone", value: contact.phone, isPhone: true })
  else if (callPhone) infoRows.push({ label: "Phone (given in chat)", value: callPhone, isPhone: true })
  if (contact.preferred_language) infoRows.push({ label: "Language", value: contact.preferred_language })
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
          ) : channel === "telegram" ? (
            <span title="Telegram" className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-white">
              <TelegramIcon className="h-7 w-7" />
            </span>
          ) : channel === "website" ? (
            <span title="Website chat" className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 shadow-md ring-2 ring-white">
              <Globe className="h-3.5 w-3.5 text-white" />
            </span>
          ) : (
            <span title="WhatsApp" className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-white">
              <WhatsAppIcon className="h-6 w-6" />
            </span>
          )}
        </div>
        {/* A long name with no spaces (an Exchange address, a phone-like
            handle) cannot wrap on its own and ran out of the panel. It may
            break anywhere, stays within two lines, and shows in full on hover. */}
        <h3 title={displayName} className="mt-4 w-full line-clamp-2 px-2 text-center text-[16px] font-bold text-slate-900 [overflow-wrap:anywhere]">{displayName}</h3>
        {contact.company && (
          <p title={contact.company} className="mt-0.5 w-full truncate px-2 text-center text-[12px] text-slate-500">{contact.company}</p>
        )}

        {/* Quick actions */}
        <div className="mt-4 flex items-center gap-2 w-full">
          {callPhone ? (
            <>
              <a href={`tel:${callPhone}`}
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
          ) : channel === "telegram" && conversationId ? (
            <button type="button" onClick={() => void askForNumber()} disabled={askingNumber}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1B78AD] py-2 text-[12px] font-semibold text-white hover:bg-[#166592] disabled:opacity-60 transition-colors">
              <Phone className="h-3.5 w-3.5" /> {askingNumber ? "Asking…" : "Ask for number"}
            </button>
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

        {/* Channels */}
        {channelLinks.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Channels</p>
            <ChannelLinks links={channelLinks} currentConversationId={conversationId} onOpen={onOpenConversation} />
          </div>
        )}

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
                    <span title={row.value} className="min-w-0 truncate text-[13px] font-medium text-slate-800">{row.value}</span>
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
              {tags.map((t) => {
                const byAi = aiApplied.find((a) => a.tag_id === t.id)
                return (
                <span key={t.contact_tag_id}
                  title={byAi ? `Added by AI — "${byAi.evidence}"` : undefined}
                  className="group/tag flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-[11px] font-semibold"
                  style={{ background: t.color + "20", color: readableTextColor(t.color) }}>
                  {byAi && <Sparkles className="h-2.5 w-2.5" aria-label="Added by AI" />}
                  {t.name}
                  <button type="button" onClick={() => handleRemoveTag(t.id)} disabled={tagBusyId === t.id}
                    aria-label={`Remove ${t.name} tag`}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/tag:opacity-100 hover:bg-black/10 disabled:opacity-50">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
                )
              })}
            </div>
          )}

          {aiSuggestions.length > 0 && (
            <div className="mt-2.5 space-y-1.5" aria-live="polite">
              {aiSuggestions.map((sg) => (
                <div key={sg.id} className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-slate-700">
                    <Sparkles className="h-3 w-3 shrink-0 text-indigo-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      AI suggests <b style={{ color: readableTextColor(sg.tag_color) }}>{sg.tag_name}</b>
                    </span>
                    <button type="button" onClick={() => void decideAiTag(sg, "accept")} disabled={aiBusy === sg.id}
                      className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                      Add
                    </button>
                    <button type="button" onClick={() => void decideAiTag(sg, "dismiss")} disabled={aiBusy === sg.id}
                      aria-label={`Dismiss the ${sg.tag_name} suggestion`}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-slate-500 hover:bg-white disabled:opacity-50">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-0.5 break-words pl-[18px] text-[11px] italic text-slate-500">“{sg.evidence}”</p>
                </div>
              ))}
            </div>
          )}

          {tagPickerOpen && (
            <div className="mt-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input autoComplete="off" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)}
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
              <textarea autoComplete="off" rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)}
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
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-700">
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
