"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft, ChevronLeft, ChevronRight, Copy, Check, Pencil, Phone, PhoneOff,
  MapPin, MessageSquare, ExternalLink, RefreshCw, Smile, Paperclip, Send, Loader2,
  FileText, Plus, Trash2, X, Image, Music, FolderOpen, LayoutTemplate,
} from "lucide-react"
import { toast } from "sonner"
import type { Lead, LeadActivity, Message, ContactNote } from "@/types"
import { CloseLeadDialog, type CloseLeadResult } from "@/components/leads/close-lead-dialog"
import { ScheduleFollowupDialog } from "@/components/leads/schedule-followup-dialog"
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline"
import { MessageBubble } from "@/components/inbox/message-bubble"
import { FileManagerPicker } from "@/components/inbox/file-manager-picker"
import { TemplatePicker, type TemplateSendValues } from "@/components/inbox/template-picker"
import { useRealtime } from "@/hooks/use-realtime"
import type { MessageTemplate } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  call_not_connected: "Not Connected",
  visited: "Visited",
  appointment_fixed: "Appointment Fixed",
  follow_up: "Follow-up",
  closed: "Closed",
}
const STATUS_COLOR: Record<string, string> = {
  new: "bg-indigo-100 text-indigo-700",
  call_not_connected: "bg-rose-100 text-rose-700",
  visited: "bg-sky-100 text-sky-700",
  appointment_fixed: "bg-amber-100 text-amber-700",
  follow_up: "bg-purple-100 text-purple-700",
  closed: "bg-emerald-100 text-emerald-700",
}

const SCORE_OPTIONS: Array<{ key: "hot" | "warm" | "cold"; label: string; emoji: string }> = [
  { key: "hot", label: "Hot", emoji: "🔥" },
  { key: "warm", label: "Warm", emoji: "🌡️" },
  { key: "cold", label: "Cold", emoji: "❄️" },
]
const SCORE_ACTIVE: Record<string, string> = {
  hot: "bg-rose-500 text-white border-rose-500",
  warm: "bg-amber-500 text-white border-amber-500",
  cold: "bg-sky-500 text-white border-sky-500",
}
const SCORE_INACTIVE: Record<string, string> = {
  hot: "bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100",
  warm: "bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100",
  cold: "bg-sky-50 text-sky-600 border-sky-100 hover:bg-sky-100",
}

const NOT_CONNECTED_REASONS = [
  { key: "out_of_coverage", label: "Out of Coverage" },
  { key: "busy", label: "Busy" },
  { key: "switched_off", label: "Switched Off" },
  { key: "invalid_number", label: "Invalid Number" },
]
const CONNECTED_OUTCOMES = [
  { key: "visited", label: "Visited" },
  { key: "appointment_fixed", label: "Appointment Fixed" },
  { key: "follow_up", label: "Follow-up" },
]

const KERALA_DISTRICTS = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod",
]

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", supervisor: "Supervisor", admin: "Admin", agent: "Agent", viewer: "Viewer",
}

const QUICK_EMOJI = [
  "😀", "😂", "😍", "🙏", "👍", "👏", "🎉", "❤️", "🔥", "✅",
  "😊", "😢", "😮", "🤔", "👋", "💯", "⭐", "📞", "📅", "⏰",
]

// Mirrors the main Inbox's MessageComposer attach menu — same categories,
// same "From Device" / "From File Manager" grouping.
const ATTACH_OPTIONS = [
  { key: "document" as const, label: "Document", icon: FileText, color: "text-blue-500", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" },
  { key: "image" as const, label: "Photos & Videos", icon: Image, color: "text-emerald-500", accept: "image/png,image/jpeg,image/webp,video/mp4,video/3gpp" },
  { key: "audio" as const, label: "Audio", icon: Music, color: "text-purple-500", accept: "audio/*" },
]

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromTab = searchParams.get("from") ?? "all"

  const [lead, setLead] = useState<Lead | null>(null)
  const [prevId, setPrevId] = useState<string | null>(null)
  const [nextId, setNextId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<LeadActivity[]>([])

  // Editable Lead Details card — local draft + debounced/explicit save
  const [district, setDistrict] = useState("")
  const [place, setPlace] = useState("")
  const [savingDetails, setSavingDetails] = useState(false)
  const dirtyRef = useRef(false)

  // Contact notes — same list/expand/delete UX as the Inbox contact sidebar,
  // per explicit request. These are ContactNote records (one per note, with
  // creator name+role), not the single Lead.notes text field.
  const [contactNotes, setContactNotes] = useState<ContactNote[]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [newNoteOpen, setNewNoteOpen] = useState(false)
  const [newNoteText, setNewNoteText] = useState("")
  const [addingNote, setAddingNote] = useState(false)

  // Log Call Outcome card
  const [connectedChoice, setConnectedChoice] = useState("")
  const [notConnectedChoice, setNotConnectedChoice] = useState("")
  const [followupOpen, setFollowupOpen] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [recording, setRecording] = useState<"connected" | "not_connected" | null>(null)

  const [copied, setCopied] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")

  // Embedded WhatsApp chat
  const [messages, setMessages] = useState<Message[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [composerText, setComposerText] = useState("")
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadLead = useCallback(() => {
    fetch(`/api/leads/${id}?from=${encodeURIComponent(fromTab)}`)
      .then((r) => r.json())
      .then((d) => {
        setLead(d.lead ?? null)
        setPrevId(d.prevId ?? null)
        setNextId(d.nextId ?? null)
        setActivities(d.lead?.activities ?? [])
        if (!dirtyRef.current) {
          setDistrict(d.lead?.district ?? "")
          setPlace(d.lead?.place ?? "")
        }
      })
      .catch(() => toast.error("Failed to load lead"))
      .finally(() => setLoading(false))
  }, [id, fromTab])

  useEffect(() => { loadLead() }, [loadLead])

  const contactId = lead?.contact_id ?? lead?.contact?.id ?? null
  const loadChat = useCallback(() => {
    if (!contactId) { setMessages([]); setConversationId(null); return }
    setChatLoading(true)
    fetch(`/api/contacts/${contactId}/timeline`)
      .then((r) => r.json())
      .then((d) => {
        const msgs: Message[] = Array.isArray(d.messages) ? d.messages : []
        setMessages(msgs)
        const lastWa = [...msgs].reverse().find((m) => !m.channel || m.channel === "whatsapp")
        setConversationId(lastWa?.conversation_id ?? null)
      })
      .catch(() => {})
      .finally(() => setChatLoading(false))
  }, [contactId])

  useEffect(() => { loadChat() }, [loadChat])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "end" }) }, [messages])

  // Instant messages — same socket.io mechanism the main Inbox uses, so new
  // messages for this lead's contact appear here live instead of only after
  // a manual refresh.
  useRealtime({
    channelName: `lead-${id}`,
    onMessageEvent: (event) => {
      if (event.eventType === "DELETE") return
      const msg = event.new
      if (!msg?.conversation_id || !msg.id) return
      const knownConvIds = new Set(messages.map((m) => m.conversation_id))
      if (conversationId) knownConvIds.add(conversationId)
      if (!knownConvIds.has(msg.conversation_id)) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) {
          return prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
        }
        return [...prev, msg as Message]
      })
    },
  })

  const loadContactNotes = useCallback(() => {
    if (!contactId) { setContactNotes([]); return }
    fetch(`/api/contacts/${contactId}/notes`)
      .then((r) => r.json())
      .then((d) => setContactNotes(Array.isArray(d.notes) ? d.notes : []))
      .catch(() => {})
  }, [contactId])

  useEffect(() => { loadContactNotes() }, [loadContactNotes])

  async function addNote() {
    if (!contactId || !newNoteText.trim()) return
    setAddingNote(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note_text: newNoteText.trim() }),
      })
      if (res.ok) {
        const body = await res.json()
        if (body.note) setContactNotes((prev) => [body.note, ...prev])
        setNewNoteText("")
        setNewNoteOpen(false)
        toast.success("Note added")
      } else {
        toast.error("Failed to add note")
      }
    } catch { toast.error("Failed to add note") }
    finally { setAddingNote(false) }
  }

  async function deleteNote(noteId: string) {
    if (!contactId) return
    const prev = contactNotes
    setContactNotes((p) => p.filter((n) => n.id !== noteId))
    const res = await fetch(`/api/contacts/${contactId}/notes/${noteId}`, { method: "DELETE" })
    if (!res.ok) { setContactNotes(prev); toast.error("Failed to delete note") }
  }

  const patchLead = useCallback(async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) { toast.error("Failed to save changes"); return false }
    const body = await res.json()
    setLead((prev) => prev ? { ...prev, ...body.lead } : body.lead)
    loadLead()
    return true
  }, [id, loadLead])

  async function saveDetails() {
    setSavingDetails(true)
    dirtyRef.current = false
    const ok = await patchLead({ district: district || null, place: place || null })
    setSavingDetails(false)
    if (ok) toast.success("Lead details saved")
  }

  async function setScore(score: string) {
    await patchLead({ score })
  }

  async function recordConnected() {
    if (!connectedChoice) return
    if (connectedChoice === "follow_up") { setFollowupOpen(true); return }
    setRecording("connected")
    await patchLead({ status: connectedChoice })
    setRecording(null)
    setConnectedChoice("")
    toast.success("Outcome recorded")
  }

  async function recordNotConnected() {
    if (!notConnectedChoice) return
    setRecording("not_connected")
    await patchLead({ status: "call_not_connected", call_outcome: notConnectedChoice })
    setRecording(null)
    setNotConnectedChoice("")
    toast.success("Outcome recorded")
  }

  async function handleFollowupSave(data: { due_at: string; note: string }) {
    await patchLead({ status: "follow_up", due_at: data.due_at, follow_up_note: data.note })
    setFollowupOpen(false)
    setConnectedChoice("")
    toast.success("Follow-up scheduled")
  }

  async function handleCloseConfirm(result: CloseLeadResult) {
    const patch: Record<string, unknown> = { status: "closed", closing_remarks: result.remarks }
    if (result.outcome === "won") patch.converted_at = new Date().toISOString()
    else patch.lost_reason = result.remarks
    await patchLead(patch)

    if (result.pipelineId && result.stageId && lead) {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: lead.title,
          pipeline_id: result.pipelineId,
          stage_id: result.stageId,
          contact_id: lead.contact_id ?? undefined,
          lead_id: lead.id,
        }),
      })
      if (!res.ok) toast.error("Lead closed, but adding to pipeline failed")
    }

    toast.success(result.outcome === "won" ? "Lead closed — Won 🎉" : "Lead closed — Lost")
  }

  async function copyPhone(value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied(null), 2000)
  }

  async function saveTitle() {
    if (!titleDraft.trim()) { setEditingTitle(false); return }
    await patchLead({ title: titleDraft.trim() })
    setEditingTitle(false)
  }

  async function sendMessage() {
    const text = composerText.trim()
    if (!text || !conversationId) return
    setSending(true)
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message_type: "text", content_text: text }),
      })
      if (!res.ok) { toast.error("Failed to send message"); return }
      setComposerText("")
      loadChat()
    } finally {
      setSending(false)
    }
  }

  function insertEmoji(emoji: string) {
    setComposerText((prev) => prev + emoji)
    setEmojiOpen(false)
  }

  function renderTemplateBody(body: string, params: string[]): string {
    return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
      const idx = Number(raw) - 1
      return params[idx] ?? `{{${raw}}}`
    })
  }

  async function handleSendTemplate(template: MessageTemplate, values: TemplateSendValues) {
    if (!conversationId) return
    const renderedBody = renderTemplateBody(template.body_text, values.body)
    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        message_type: "template",
        template_name: template.name,
        template_language: template.language,
        template_message_params: {
          body: values.body,
          headerText: values.headerText,
          buttonParams: values.buttonParams,
        },
        template_params: values.body,
        content_text: renderedBody,
      }),
    })
    if (!res.ok) { toast.error("Failed to send template"); return }
    loadChat()
  }

  async function sendMediaUrl(url: string, mediaType: "image" | "document" | "audio" | "video") {
    if (!conversationId) return
    const sendRes = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, message_type: mediaType, media_url: url }),
    })
    if (!sendRes.ok) { toast.error("Failed to send attachment"); return }
    loadChat()
  }

  function openFilePicker(accept: string) {
    setAttachOpen(false)
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !conversationId) return

    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form })
      if (!uploadRes.ok) { toast.error("Upload failed"); return }
      const { url } = await uploadRes.json()

      const mediaType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "document"

      await sendMediaUrl(url, mediaType)
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
    }
  }

  function goTo(targetId: string | null) {
    if (!targetId) return
    router.push(`/leads/${targetId}?from=${encodeURIComponent(fromTab)}`)
  }

  function jumpToDate(dateKey: string) {
    const target = messages.find((m) => new Date(m.created_at).toISOString().slice(0, 10) >= dateKey)
    if (!target) { toast.info("No messages around that date"); return }
    document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (loading) return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-8 w-8 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-white rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  if (!lead) return (
    <div className="flex flex-col h-full bg-[#F4F6FA] items-center justify-center">
      <p className="text-[14px] text-slate-400">Lead not found</p>
      <button onClick={() => router.push("/leads")} className="mt-3 text-[13px] text-indigo-600 hover:underline">Back to Leads</button>
    </div>
  )

  const phone = lead.contact?.phone
  const altPhone = lead.contact?.alternate_phone
  const displayName = lead.contact?.name || lead.title

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100 shrink-0">
        <button onClick={() => router.push("/leads")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100 shrink-0">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1 text-[14px]">
          <button onClick={() => router.push("/leads")} className="text-slate-400 hover:text-slate-600 shrink-0">Leads</button>
          <span className="text-slate-300 shrink-0">/</span>
          <span className="font-bold text-slate-800 truncate">{lead.title}</span>
          <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold", STATUS_COLOR[lead.status] ?? "bg-slate-100 text-slate-600")}>
            {STATUS_LABEL[lead.status] ?? lead.status}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 rounded-xl border border-slate-200 p-0.5">
          <button onClick={() => goTo(prevId)} disabled={!prevId}
            className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
          </button>
          <button onClick={() => goTo(nextId)} disabled={!nextId}
            className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </div>

        <button onClick={() => setCloseDialogOpen(true)}
          className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-rose-50 text-rose-600 text-[12px] font-semibold hover:bg-rose-100 shrink-0">
          Close Lead
        </button>

        <button onClick={saveDetails} disabled={savingDetails}
          className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-60 shrink-0">
          {savingDetails ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
      </div>

      {/* Body — left: scrollable lead workspace, right: fixed WhatsApp chat */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 xl:grid-cols-[1fr_420px]">
        <div className="overflow-y-auto p-6 space-y-4">
          {/* Contact hero card */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-wrap items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white text-xl font-black">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <input autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                    className="h-7 rounded-lg border border-indigo-300 px-2 text-[15px] font-bold text-slate-800 outline-none" />
                ) : (
                  <h1 className="text-[16px] font-bold text-slate-800 truncate">{displayName}</h1>
                )}
                {lead.score && (
                  <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize flex items-center gap-1",
                    lead.score === "hot" ? "bg-rose-100 text-rose-700" : lead.score === "warm" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}>
                    {SCORE_OPTIONS.find((s) => s.key === lead.score)?.emoji} {lead.score}
                  </span>
                )}
              </div>
              {(lead.district || lead.place) && (
                <p className="flex items-center gap-1 text-[12px] text-slate-400 mt-0.5">
                  <MapPin className="h-3 w-3" /> {[lead.place, lead.district].filter(Boolean).join(", ")}
                </p>
              )}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {phone && (
                <>
                  <span className="text-[14px] font-bold text-slate-800">{phone}</span>
                  <a href={`tel:${phone}`} className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600">
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                  <button onClick={() => copyPhone(phone)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50">
                    {copied === phone ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                  </button>
                </>
              )}
              <button onClick={() => { setEditingTitle(true); setTitleDraft(lead.title) }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {altPhone && (
                <div className="w-full flex items-center gap-2 pt-1">
                  <a href={`tel:${altPhone}`} className="flex items-center gap-1.5 text-[13px] text-slate-600 hover:text-indigo-600">
                    <Phone className="h-3 w-3" /> {altPhone}
                  </a>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-semibold">Call Alt</span>
                </div>
              )}
            </div>
          </div>

          {/* Lead Details + Log Call Outcome */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Lead Details */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Lead Details</p>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">District</label>
                  <select value={district} onChange={(e) => { setDistrict(e.target.value); dirtyRef.current = true }}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400">
                    <option value="">Select district…</option>
                    {KERALA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Place / Area</label>
                  <input value={place} onChange={(e) => { setPlace(e.target.value); dirtyRef.current = true }}
                    placeholder="City / area"
                    className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Lead Score</label>
                  <div className="grid grid-cols-3 gap-2">
                    {SCORE_OPTIONS.map((s) => (
                      <button key={s.key} onClick={() => setScore(s.key)}
                        className={cn("h-9 rounded-xl border text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors",
                          lead.score === s.key ? SCORE_ACTIVE[s.key] : SCORE_INACTIVE[s.key])}>
                        {s.emoji} {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Notes — same list/expand/delete UX as the Inbox contact sidebar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setNotesOpen((v) => !v)} disabled={!contactId}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-700 disabled:opacity-50">
                      <FileText className="h-3.5 w-3.5" />
                      Notes
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{contactNotes.length}</span>
                    </button>
                    <button type="button" onClick={() => setNewNoteOpen((v) => !v)} disabled={!contactId}
                      className={cn("flex h-6 w-6 items-center justify-center rounded-lg transition-all disabled:opacity-40",
                        newNoteOpen ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
                      {newNoteOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {newNoteOpen && (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
                      <textarea rows={3} value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)}
                        placeholder="Write a note…" autoFocus
                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setNewNoteOpen(false); setNewNoteText("") }} disabled={addingNote}
                          className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                          Cancel
                        </button>
                        <button type="button" onClick={addNote} disabled={addingNote || !newNoteText.trim()}
                          className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                          {addingNote ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}

                  {notesOpen && (
                    contactNotes.length === 0 ? (
                      <p className="text-[12px] text-slate-400 italic">No notes yet</p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {contactNotes.map((note) => (
                          <div key={note.id} className="group/note rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">{note.note_text}</p>
                              <button type="button" onClick={() => deleteNote(note.id)}
                                aria-label="Delete note"
                                className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-amber-500 opacity-0 group-hover/note:opacity-100 hover:bg-amber-100 transition-opacity">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-600">
                              {note.created_by_name && <span className="font-semibold text-amber-700">{note.created_by_name}</span>}
                              {note.created_by_role && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                                  {ROLE_LABEL[note.created_by_role] ?? note.created_by_role}
                                </span>
                              )}
                              <span>{note.created_at ? new Date(note.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
                <button onClick={saveDetails} disabled={savingDetails}
                  className="w-full h-10 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {savingDetails && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Changes
                </button>
                <div className="pt-2 border-t border-slate-100 space-y-0.5">
                  <p className="text-[11px] text-slate-400">Created: {new Date(lead.created_at).toLocaleString()}</p>
                  <p className="text-[11px] text-slate-400">Updated: {new Date(lead.updated_at).toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Log Call Outcome */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-4">
                <Phone className="h-3.5 w-3.5" /> Log Call Outcome
              </p>
              <div className="space-y-4">
                {/* Connected */}
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 space-y-2.5">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-700">
                    <Phone className="h-4 w-4" /> Connected
                  </p>
                  <select value={connectedChoice} onChange={(e) => setConnectedChoice(e.target.value)}
                    className="w-full h-9 rounded-xl border border-emerald-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100">
                    <option value="">Choose outcome…</option>
                    {CONNECTED_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <button onClick={recordConnected} disabled={!connectedChoice || recording !== null}
                    className="w-full h-10 rounded-xl bg-emerald-500 text-white text-[13px] font-bold hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                    {recording === "connected" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record Outcome
                  </button>
                </div>

                {/* Not Connected */}
                <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 space-y-2.5">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-rose-600">
                    <PhoneOff className="h-4 w-4" /> Not Connected
                  </p>
                  <select value={notConnectedChoice} onChange={(e) => setNotConnectedChoice(e.target.value)}
                    className="w-full h-9 rounded-xl border border-rose-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-100">
                    <option value="">Choose reason…</option>
                    {NOT_CONNECTED_REASONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <button onClick={recordNotConnected} disabled={!notConnectedChoice || recording !== null}
                    className="w-full h-10 rounded-xl bg-rose-500 text-white text-[13px] font-bold hover:bg-rose-600 disabled:opacity-50 flex items-center justify-center gap-2">
                    {recording === "not_connected" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record Outcome
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline — below the grid, reached by scrolling */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Timeline</p>
            <LeadActivityTimeline activities={activities} isClosed={lead.status === "closed"} onItemClick={contactId ? jumpToDate : undefined} />
          </div>
        </div>

        {/* WhatsApp Chat panel */}
        <div className="flex flex-col overflow-hidden border-l border-slate-100 bg-white">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
            <MessageSquare className="h-4 w-4 text-emerald-500" />
            <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">WhatsApp Chat</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white text-[12px] font-bold">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800 truncate">{displayName}</p>
              <p className="text-[11px] text-slate-400">WhatsApp</p>
            </div>
            <button onClick={loadChat} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 shrink-0" title="Refresh">
              <RefreshCw className={cn("h-3.5 w-3.5 text-slate-400", chatLoading && "animate-spin")} />
            </button>
            <button onClick={() => router.push(conversationId ? `/inbox?c=${conversationId}` : "/inbox")}
              className="flex items-center gap-1 shrink-0 h-7 px-2.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <ExternalLink className="h-3 w-3" /> Inbox
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#EFEAE2]">
            {!contactId ? (
              <p className="text-center text-[13px] text-slate-400 mt-8">This lead has no linked contact.</p>
            ) : chatLoading && messages.length === 0 ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-white/60 rounded-xl animate-pulse" />)}
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-[13px] text-slate-400 mt-8">No messages yet.</p>
            ) : (
              <>
                {messages.map((m) => (
                  <div key={m.id} id={`msg-${m.id}`} className="flex">
                    <MessageBubble message={m} />
                  </div>
                ))}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          <div className="border-t border-slate-100 p-3 shrink-0">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" />
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="relative shrink-0">
                <button type="button" onClick={() => setEmojiOpen((v) => !v)} disabled={!conversationId}
                  className="text-slate-400 hover:text-slate-600 disabled:opacity-40" title="Emoji">
                  <Smile className="h-4 w-4" />
                </button>
                {emojiOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
                    <div className="absolute bottom-9 left-0 z-20 grid grid-cols-5 gap-1 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                      {QUICK_EMOJI.map((e) => (
                        <button key={e} type="button" onClick={() => insertEmoji(e)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[17px] hover:bg-slate-100">
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="relative shrink-0">
                <button type="button" onClick={() => setAttachOpen((v) => !v)} disabled={!conversationId || uploading}
                  className="text-slate-400 hover:text-slate-600 disabled:opacity-40" title="Attach">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
                {attachOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                    <div className="absolute bottom-9 left-0 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                      <button type="button" onClick={() => { setAttachOpen(false); setTemplatePickerOpen(true) }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                        <LayoutTemplate className="h-4 w-4 shrink-0 text-amber-500" />
                        Message Template
                      </button>
                      <div className="mx-3 my-1 border-t border-slate-100" />
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">From Device</div>
                      {ATTACH_OPTIONS.map(({ key, label, icon: Icon, color, accept }) => (
                        <button key={key} type="button" onClick={() => openFilePicker(accept)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                          <Icon className={cn("h-4 w-4 shrink-0", color)} />
                          {label}
                        </button>
                      ))}
                      <div className="mx-3 my-1 border-t border-slate-100" />
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">From File Manager</div>
                      <button type="button" onClick={() => { setAttachOpen(false); setFilePickerOpen(true) }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                        <FolderOpen className="h-4 w-4 shrink-0 text-indigo-500" />
                        Browse Files
                      </button>
                    </div>
                  </>
                )}
              </div>
              <input value={composerText} onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder={conversationId ? "Type a message…" : "No WhatsApp conversation yet"}
                disabled={!conversationId || sending}
                className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-800 outline-none disabled:opacity-50" />
              <button onClick={sendMessage} disabled={!conversationId || !composerText.trim() || sending}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1 text-right text-[10px] text-slate-400">Enter to send · Shift+Enter new line</p>
          </div>
        </div>
      </div>

      <CloseLeadDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen} onConfirm={handleCloseConfirm} />

      <ScheduleFollowupDialog
        open={followupOpen}
        onOpenChange={(v) => { setFollowupOpen(v); if (!v) setConnectedChoice("") }}
        onSave={handleFollowupSave}
      />

      <FileManagerPicker
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
        onSelect={(file) => {
          const mediaType: "image" | "document" | "audio" | "video" =
            file.file_category === "image" ? "image"
            : file.file_category === "video" ? "video"
            : file.file_category === "audio" ? "audio"
            : "document"
          void sendMediaUrl(file.url, mediaType)
        }}
      />

      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  )
}
