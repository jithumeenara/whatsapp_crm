"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSessionWindow } from "@/lib/hooks/use-session-window"
import {
  ArrowLeft, ChevronLeft, ChevronRight, Check, Pencil, Phone, PhoneOff,
  MapPin, MessageSquare, ExternalLink, RefreshCw, Paperclip, Send, Loader2,
  FileText, Plus, Trash2, X, Image, Music, FolderOpen, LayoutTemplate, Sparkles, MoreVertical,
} from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { useConfirm } from "@/hooks/use-confirm"
import { dayKeyInZone, formatInZone } from "@/lib/format/business-time"
import { shrinkImageForWhatsApp, WHATSAPP_IMAGE_MAX_BYTES } from "@/lib/media/shrink-image"
import { GenderBadge } from "@/components/contacts/gender-badge"
import type { Lead, LeadActivity, Message, ContactNote } from "@/types"
import { outcomeOf, OUTCOME_COLOR, OUTCOME_LABEL } from "@/lib/leads/outcome"
import { CloseLeadDialog, type CloseLeadResult } from "@/components/leads/close-lead-dialog"
import { LeadStageCard } from "@/components/leads/lead-stage-card"
import { LeadAdCard } from "@/components/leads/lead-ad-card"
import { ScheduleFollowupDialog } from "@/components/leads/schedule-followup-dialog"
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline"
import { MessageBubble } from "@/components/inbox/message-bubble"
import { useAuth } from "@/hooks/use-auth"
import { FileManagerPicker } from "@/components/inbox/file-manager-picker"
import { EmojiPickerPopover } from "@/components/inbox/emoji-picker-popover"
import { ScheduleMenuButton } from "@/components/inbox/schedule-menu-button"
import { TemplatePicker, type TemplateSendValues } from "@/components/inbox/template-picker"
import { NewChatDialog } from "@/components/shared/new-chat-dialog"
import { LeadDescription } from "@/components/leads/lead-description"
import { LeadTags } from "@/components/leads/lead-tags"
import { LeadFollowUps, type LeadFollowUp } from "@/components/leads/lead-follow-ups"
import { ContactForm } from "@/components/contacts/contact-form"
import { useRealtime } from "@/hooks/use-realtime"
import type { MessageTemplate, Contact } from "@/types"
import dynamic from "next/dynamic"
import Link from "next/link"

// Admins only (the component checks, the API enforces); loaded on demand.
const RecordHistoryButton = dynamic(() => import("@/components/audit/record-history").then((m) => m.RecordHistoryButton))

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  open: "Open",
  call_not_connected: "Not connected",
  visited: "Visited",
  appointment_fixed: "Appointment fixed",
  follow_up: "Follow-up",
  closed: "Closed",
}
const STATUS_COLOR: Record<string, string> = {
  new: "bg-indigo-100 text-indigo-700",
  open: "bg-sky-100 text-sky-700",
  call_not_connected: "bg-rose-100 text-rose-700",
  visited: "bg-sky-100 text-sky-700",
  appointment_fixed: "bg-amber-100 text-amber-700",
  follow_up: "bg-purple-100 text-purple-700",
  closed: "bg-emerald-100 text-emerald-700",
}

/** The account's score levels, hottest first (Settings → Leads); these until they load. */
type ScoreOption = { icon: string; label: string }
const DEFAULT_SCORES: ScoreOption[] = [
  { icon: "🔥", label: "Hot" }, { icon: "🌡️", label: "Warm" }, { icon: "❄️", label: "Cold" },
]
type ScoreTone = "hot" | "mid" | "cold"
/** Hottest level red, coldest blue, the ones between amber — by place, not by word. */
function scoreTone(index: number, count: number): ScoreTone {
  if (count >= 2 && index === 0) return "hot"
  if (count >= 2 && index === count - 1) return "cold"
  return "mid"
}
const SCORE_ACTIVE: Record<ScoreTone, string> = {
  hot: "bg-rose-600 text-white border-rose-600 shadow-sm ring-2 ring-rose-200",
  mid: "bg-amber-500 text-white border-amber-500 shadow-sm ring-2 ring-amber-200",
  cold: "bg-sky-600 text-white border-sky-600 shadow-sm ring-2 ring-sky-200",
}
const SCORE_INACTIVE: Record<ScoreTone, string> = {
  hot: "bg-white text-rose-700 border-rose-200 hover:bg-rose-50",
  mid: "bg-white text-amber-800 border-amber-200 hover:bg-amber-50",
  cold: "bg-white text-sky-700 border-sky-200 hover:bg-sky-50",
}
const SCORE_BADGE: Record<ScoreTone, string> = { hot: "bg-rose-100", mid: "bg-amber-100", cold: "bg-sky-100" }
/** "Hot" (Leads list, new-lead form) and "hot" (older saves here) are the same level. */
const sameScore = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase()

const NOT_CONNECTED_REASONS = [
  { key: "out_of_coverage", label: "Out of coverage" },
  { key: "busy", label: "Busy" },
  { key: "switched_off", label: "Switched off" },
  { key: "invalid_number", label: "Invalid number" },
]
const CONNECTED_OUTCOMES = [
  { key: "visited", label: "Visited" },
  { key: "appointment_fixed", label: "Appointment fixed" },
  { key: "follow_up", label: "Follow-up" },
]

/** The upload route's limit; bigger files are refused before they are sent. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", supervisor: "Supervisor", admin: "Admin", agent: "Agent", viewer: "Viewer",
}

// Mirrors the main Inbox's MessageComposer attach menu — same categories,
// same "From Device" / "From File Manager" grouping.
const ATTACH_OPTIONS = [
  { key: "document" as const, label: "Document", icon: FileText, color: "text-blue-500", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" },
  { key: "image" as const, label: "Photos & videos", icon: Image, color: "text-emerald-500", accept: "image/png,image/jpeg,image/webp,video/mp4,video/3gpp" },
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
  // The person's age and address live on the contact (migration 148).
  const [age, setAge] = useState("")
  const [address, setAddress] = useState("")
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
  const [callMode, setCallMode] = useState<"connected" | "not_connected">("connected")
  const [followupOpen, setFollowupOpen] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [recording, setRecording] = useState<"connected" | "not_connected" | null>(null)

  const [copied, setCopied] = useState<string | null>(null)
  const [scoreOptions, setScoreOptions] = useState<ScoreOption[]>(DEFAULT_SCORES)
  /** The business's own districts (Settings → Leads); none = type it freely. */
  const [districts, setDistricts] = useState<string[]>([])
  const [savingScore, setSavingScore] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  // The account's own score levels, so the buttons match the Leads list.
  useEffect(() => {
    let current = true
    apiFetch("/api/leads/settings")
      .then((r) => r.json())
      .then((sr: { score_options?: unknown; districts?: unknown }) => {
        if (!current) return
        if (Array.isArray(sr.districts)) {
          setDistricts(sr.districts.map((d: unknown) => (typeof d === "string" ? d : (d as { label?: string })?.label ?? "")).filter(Boolean))
        }
        if (!Array.isArray(sr.score_options) || sr.score_options.length === 0) return
        const list = sr.score_options
          .map((v: unknown) => (typeof v === "string" ? { icon: "", label: v } : (v as ScoreOption)))
          .filter((o) => o && typeof o.label === "string" && o.label.trim() !== "")
        if (list.length > 0) setScoreOptions(list)
      })
      .catch((err) => console.warn("[lead] score levels failed:", err))
    return () => { current = false }
  }, [])

  // The phone menu closes on Escape.
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [moreOpen])
  const [contactEditOpen, setContactEditOpen] = useState(false)
  const [contactEditData, setContactEditData] = useState<Contact | null>(null)
  const [contactEditLoading, setContactEditLoading] = useState(false)

  // Embedded WhatsApp chat
  const [messages, setMessages] = useState<Message[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // "website" when the lead's latest chat is the website one: no 24-hour
  // window and no WhatsApp templates there.
  const [conversationChannel, setConversationChannel] = useState<string>("whatsapp")
  const [composerText, setComposerText] = useState("")
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const { userId, canViewAllLeads, account } = useAuth()
  const zone = account?.timezone ?? "Asia/Kolkata"
  const confirm = useConfirm()
  // Managers hand a lead to anyone on the team (and the chat with it).
  const [teamMembers, setTeamMembers] = useState<Array<{ user_id: string; full_name: string | null; email: string | null; role?: string }>>([])
  const [assigning, setAssigning] = useState(false)
  useEffect(() => {
    if (!canViewAllLeads) return
    let current = true
    fetch("/api/account/members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((j: { members?: Array<{ user_id: string; full_name: string | null; email: string | null; role?: string }> }) => {
        if (current) setTeamMembers((j.members ?? []).filter((m) => m.role !== "viewer"))
      })
      .catch((err) => console.warn("[lead] members failed:", err))
    return () => { current = false }
  }, [canViewAllLeads])
  const [picking, setPicking] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 24-hour session window — same rule the main Inbox composer enforces,
  // now shared with message-thread.tsx via useSessionWindow so the two
  // surfaces can never drift out of sync.
  // Counted from WhatsApp messages only; a website chat has no window.
  const whatsappMessages = useMemo(() => messages.filter((m) => !m.channel || m.channel === "whatsapp"), [messages])
  const whatsappSessionExpired = useSessionWindow(whatsappMessages).expired
  // Website and Telegram chats: no 24-hour window, no WhatsApp templates.
  const isWebsiteChat = conversationChannel === "website" || conversationChannel === "telegram"
  const sessionExpired = whatsappSessionExpired && !isWebsiteChat
  const channelName = conversationChannel === "website" ? "Website" : conversationChannel === "telegram" ? "Telegram" : "WhatsApp"

  const [loadError, setLoadError] = useState<string | null>(null)
  const loadLead = useCallback(() => {
    apiFetch(`/api/leads/${id}?from=${encodeURIComponent(fromTab)}`)
      .then((r) => r.json())
      .then((d) => {
        setLoadError(null)
        setLead(d.lead ?? null)
        setPrevId(d.prevId ?? null)
        setNextId(d.nextId ?? null)
        setActivities(d.lead?.activities ?? [])
        if (!dirtyRef.current) {
          setDistrict(d.lead?.district ?? "")
          setPlace(d.lead?.place ?? "")
          setAge(d.lead?.contact?.age != null ? String(d.lead.contact.age) : "")
          setAddress(d.lead?.contact?.address ?? "")
        }
      })
      .catch((err) => {
        console.error("[lead] load failed:", err)
        // 404 is "no such lead"; anything else is worth saying.
        if ((err as { status?: number })?.status !== 404) setLoadError(errorText(err, "Could not load this lead."))
      })
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
        // The latest WhatsApp or website chat — a lead from the website
        // chat window is answered there.
        const lastChat = [...msgs].reverse().find((m) => !m.channel || m.channel === "whatsapp" || m.channel === "website" || m.channel === "telegram")
        setConversationId(lastChat?.conversation_id ?? null)
        setConversationChannel(lastChat?.channel === "website" || lastChat?.channel === "telegram" ? lastChat.channel : "whatsapp")
      })
      .catch((err) => console.warn("[lead] chat load failed:", err))
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
      const res = await apiFetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note_text: newNoteText.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (body.note) setContactNotes((prev) => [body.note, ...prev])
      else loadContactNotes()
      setNewNoteText("")
      setNewNoteOpen(false)
      setNotesOpen(true)
      toast.success("Note added")
    } catch (err) {
      console.error("[lead] add note failed:", err)
      toast.error(errorText(err, "Could not add the note."))
    } finally { setAddingNote(false) }
  }

  async function deleteNote(noteId: string) {
    if (!contactId) return
    const ok = await confirm({ title: "Delete this note?", description: "The note is removed for everyone. This cannot be undone.", confirmLabel: "Delete note", variant: "destructive" })
    if (!ok) return
    try {
      await apiFetch(`/api/contacts/${contactId}/notes/${noteId}`, { method: "DELETE" })
      setContactNotes((p) => p.filter((n) => n.id !== noteId))
      toast.success("Note deleted")
    } catch (err) {
      console.error("[lead] delete note failed:", err)
      toast.error(errorText(err, "Could not delete the note."))
    }
  }

  /**
   * Take this lead.
   *
   * Sent as an explicit assignment rather than relying on the API's
   * claim-by-working-on-it rule, because this is not a side effect of
   * changing something — it is the whole intention, and it should
   * behave identically whether or not anything else gets edited after.
   */
  const pickLead = useCallback(async () => {
    if (!userId) return
    setPicking(true)
    try {
      const res = await apiFetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigned_to: userId }),
      })
      const body = await res.json()
      setLead((prev) => prev ? { ...prev, ...body.lead } : body.lead)
      toast.success("Lead picked")
    } catch (err) {
      console.error("[lead] pick failed:", err)
      toast.error(errorText(err, "Could not pick this lead."))
    } finally {
      setPicking(false)
    }
  }, [id, userId])

  /** True only when the server saved it; a failure says why, once. */
  const patchLead = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const res = await apiFetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
      const body = await res.json()
      setLead((prev) => prev ? { ...prev, ...body.lead } : body.lead)
      loadLead()
      return true
    } catch (err) {
      console.error("[lead] save failed:", err)
      toast.error(errorText(err, "Could not save the change."))
      return false
    }
  }, [id, loadLead])

  async function saveDetails() {
    if (savingDetails) return
    setSavingDetails(true)
    dirtyRef.current = false
    const ok = await patchLead({ district: district || null, place: place || null })
    // Age and address belong to the contact: saved there, only when changed.
    let contactOk = true
    const was = lead?.contact
    if (contactId && (age.trim() !== (was?.age != null ? String(was.age) : "") || address.trim() !== (was?.address ?? "").trim())) {
      try {
        await apiFetch(`/api/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age: age.trim(), address }),
        })
      } catch (err) {
        console.error("[lead] contact details failed:", err)
        toast.error(errorText(err, "Could not save age and address."))
        dirtyRef.current = true
        contactOk = false
      }
    }
    setSavingDetails(false)
    if (ok && contactOk) { toast.success("Lead details saved"); loadLead() }
  }

  async function setScore(score: string) {
    if (savingScore) return
    setSavingScore(score)
    try { await patchLead({ score }) } finally { setSavingScore(null) }
  }

  async function recordConnected() {
    if (!connectedChoice) return
    if (connectedChoice === "follow_up") { setFollowupOpen(true); return }
    setRecording("connected")
    const ok = await patchLead({ status: connectedChoice, call_result: "connected" })
    setRecording(null)
    if (!ok) return
    setConnectedChoice("")
    toast.success("Outcome recorded")
  }

  async function recordNotConnected() {
    if (!notConnectedChoice) return
    setRecording("not_connected")
    const ok = await patchLead({ status: "call_not_connected", call_outcome: notConnectedChoice, call_result: "not_connected" })
    setRecording(null)
    if (!ok) return
    setNotConnectedChoice("")
    toast.success("Outcome recorded")
  }

  async function handleFollowupSave(data: { due_at: string; note: string }): Promise<boolean> {
    // Only reached from "Connected → Follow-up", so it is a connected call.
    const ok = await patchLead({ status: "follow_up", due_at: data.due_at, follow_up_note: data.note, call_result: "connected" })
    if (!ok) return false
    setFollowupOpen(false)
    setConnectedChoice("")
    toast.success("Follow-up scheduled")
    return true
  }

  async function handleCloseConfirm(result: CloseLeadResult) {
    const patch: Record<string, unknown> = { status: "closed", closing_remarks: result.remarks }
    if (result.outcome === "won") patch.converted_at = new Date().toISOString()
    else {
      patch.lost_reason = result.remarks
      if (result.reasonKey) patch.lost_reason_key = result.reasonKey
    }
    // Not closed: the dialog stays open with what was typed.
    if (!(await patchLead(patch))) throw new Error("not saved")

    if (result.pipelineId && result.stageId && lead) {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: result.dealTitle?.trim() || lead.title,
          pipeline_id: result.pipelineId,
          stage_id: result.stageId,
          contact_id: lead.contact_id ?? undefined,
          lead_id: lead.id,
          value: result.dealValue,
          lost_reason: result.outcome === "lost" ? result.remarks : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        console.error("[lead] closed, but the deal failed:", res.status, body.error)
        toast.error(body.error ? `Lead closed, but the deal was not added: ${body.error}` : "Lead closed, but adding it to the pipeline failed.")
      }
    }

    toast.success(result.outcome === "won" ? "Lead closed — Won 🎉" : "Lead closed — Lost")

    // Back to the list, because this lead is finished.
    //
    // Staying here left an agent looking at a closed record with
    // nothing left to do on it — and the next thing they want is
    // always the next lead, so they pressed back anyway. Returning to
    // the tab they came from keeps their place: closing one out of New
    // Pool should not drop them into Mine.
    setCloseDialogOpen(false)
    router.push(fromTab ? `/leads?tab=${encodeURIComponent(fromTab)}` : "/leads")
  }

  async function copyPhone(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      toast.success("Number copied")
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.warn("[lead] copy failed:", err)
      toast.error("Could not copy the number. Select it and copy it yourself.")
    }
  }

  async function openContactEdit() {
    if (!contactId) return
    setContactEditLoading(true)
    try {
      const res = await apiFetch(`/api/contacts/${contactId}`)
      const body = await res.json()
      setContactEditData(body.contact ?? null)
      setContactEditOpen(true)
    } catch (err) {
      console.error("[lead] contact load failed:", err)
      toast.error(errorText(err, "Could not open the contact."))
    } finally {
      setContactEditLoading(false)
    }
  }

  /**
   * Drafts a reply from this lead's conversation.
   *
   * The same endpoint the inbox uses, so an agent gets the same answer
   * wherever they happen to be working — nothing is sent, the draft
   * lands in the box for them to approve or rewrite.
   */
  async function draftReply() {
    if (!conversationId || drafting) return
    setDrafting(true)
    try {
      const res = await apiFetch("/api/messages/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      })
      const data = await res.json()
      setComposerText(typeof data.draft === "string" ? data.draft : "")
      // Warnings are surfaced rather than swallowed: a weak knowledge
      // match is exactly what the agent should check before sending.
      for (const warning of (data.warnings ?? []) as string[]) toast.warning(warning)
    } catch (err) {
      console.error("[lead] draft failed:", err)
      toast.error(errorText(err, "Could not draft a reply."))
    } finally {
      setDrafting(false)
    }
  }

  async function sendMessage() {
    const text = composerText.trim()
    if (!text || !conversationId || sessionExpired) return
    if (sending) return
    setSending(true)
    try {
      await apiFetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message_type: "text", content_text: text }),
      })
      setComposerText("")
      loadChat()
    } catch (err) {
      console.error("[lead] send failed:", err)
      toast.error(errorText(err, "The message was not sent."))
    } finally {
      setSending(false)
    }
  }

  function insertEmoji(emoji: string) {
    setComposerText((prev) => prev + emoji)
  }

  function renderTemplateBody(body: string, params: string[], bodyByName?: Record<string, string>): string {
    if (bodyByName && Object.keys(bodyByName).length > 0) {
      return body.replace(/\{\{([^}]+)\}\}/g, (_, rawKey) => bodyByName[rawKey.trim()] ?? `{{${rawKey}}}`)
    }
    return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
      const idx = Number(raw) - 1
      return params[idx] ?? `{{${raw}}}`
    })
  }

  async function handleSendTemplate(template: MessageTemplate, values: TemplateSendValues) {
    if (!conversationId) return
    const renderedBody = renderTemplateBody(template.body_text, values.body, values.bodyByName)
    try {
    await apiFetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        message_type: "template",
        template_name: template.name,
        template_language: template.language,
        template_message_params: {
          body: values.body,
          bodyByName: values.bodyByName,
          headerText: values.headerText,
          headerMediaUrl: values.headerMediaUrl,
          buttonParams: values.buttonParams,
        },
        template_params: values.body,
        content_text: renderedBody,
      }),
    })
    loadChat()
    } catch (err) {
      console.error("[lead] template send failed:", err)
      toast.error(errorText(err, "The template was not sent."))
    }
  }

  async function sendMediaUrl(url: string, mediaType: "image" | "document" | "audio" | "video") {
    if (!conversationId) return
    try {
      await apiFetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message_type: mediaType, media_url: url }),
      })
      loadChat()
    } catch (err) {
      console.error("[lead] attachment send failed:", err)
      toast.error(errorText(err, "The attachment was not sent."))
    }
  }

  function openFilePicker(accept: string) {
    setAttachOpen(false)
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ""
    if (!picked || !conversationId) return

    setUploading(true)
    try {
      // A photo goes as a WhatsApp image, which must be under 5 MB: camera
      // photos are shrunk first. Anything else must fit the 16 MB upload.
      const file = picked.type.startsWith("image/") ? await shrinkImageForWhatsApp(picked) : picked
      if (file.type.startsWith("image/") && file.size > WHATSAPP_IMAGE_MAX_BYTES) {
        toast.error("This photo is over 5 MB, the most WhatsApp accepts for an image. Send it from the Inbox as a document instead.")
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error("This file is over 16 MB, the most that can be sent. Make it smaller and try again.")
        return
      }
      const form = new FormData()
      form.append("file", file)
      const uploadRes = await apiFetch("/api/upload", { method: "POST", body: form })
      const { url } = await uploadRes.json()

      const mediaType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "document"

      await sendMediaUrl(url, mediaType)
    } catch (err) {
      console.error("[lead] upload failed:", err)
      toast.error(errorText(err, "The upload failed."))
    } finally {
      setUploading(false)
    }
  }

  function goTo(targetId: string | null) {
    if (!targetId) return
    router.push(`/leads/${targetId}?from=${encodeURIComponent(fromTab)}`)
  }

  /** dateKey is a business-zone day (YYYY-MM-DD); messages are matched the same way. */
  function jumpToDate(dateKey: string) {
    const target = messages.find((m) => dayKeyInZone(m.created_at, zone) >= dateKey)
    if (!target) { toast.info("No messages around that date"); return }
    document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (loading) return (
    <div className="flex flex-col h-full bg-background" aria-busy="true" aria-label="Loading the lead">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-8 w-8 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-white rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  const listHref = fromTab ? `/leads?tab=${encodeURIComponent(fromTab)}` : "/leads"

  if (!lead) return (
    <div className="flex flex-col h-full bg-background items-center justify-center px-4 text-center">
      <p role={loadError ? "alert" : undefined} className="text-[14px] text-slate-600">{loadError ?? "This lead was not found. It may have been deleted, or it belongs to someone else."}</p>
      <div className="mt-3 flex gap-3">
        {loadError && <button type="button" onClick={() => { setLoading(true); loadLead() }} className="text-[13px] font-medium text-indigo-700 hover:underline">Try again</button>}
        <button type="button" onClick={() => router.push(listHref)} className="text-[13px] font-medium text-indigo-700 hover:underline">Back to leads</button>
      </div>
    </div>
  )

  const phone = lead.contact?.phone
  const altPhone = lead.contact?.alternate_phone
  const displayName = lead.contact?.name || lead.title
  // Null unless this lead is closed; then 'won', 'lost' or plain
  // 'closed' when nobody recorded which.
  const leadOutcome = outcomeOf(lead)
  const scoreIndex = scoreOptions.findIndex((o) => sameScore(lead.score, o.label))

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 bg-white border-b border-slate-100 shrink-0">
        <button type="button" onClick={() => router.push(listHref)} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100 shrink-0" aria-label="Back to leads">
          <ArrowLeft className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1 text-[14px]">
          <button type="button" onClick={() => router.push(listHref)} className="hidden sm:inline text-slate-500 hover:text-slate-700 shrink-0">Leads</button>
          <span className="hidden sm:inline text-slate-300 shrink-0" aria-hidden="true">/</span>
          <span className="font-bold text-slate-800 truncate" title={lead.title}>{lead.title}</span>
          {/* A closed lead says how it ended. "Closed" was the same
              word for somebody who signed up and somebody who went
              elsewhere — see src/lib/leads/outcome.ts. */}
          <span
            className={cn(
              "shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold",
              leadOutcome
                ? OUTCOME_COLOR[leadOutcome]
                : STATUS_COLOR[lead.status] ?? "bg-slate-100 text-slate-600",
            )}
            title={leadOutcome === "lost" && lead.lost_reason ? lead.lost_reason : undefined}
          >
            {leadOutcome ? OUTCOME_LABEL[leadOutcome] : STATUS_LABEL[lead.status] ?? lead.status}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1 shrink-0 rounded-xl border border-slate-200 p-0.5">
          <button type="button" onClick={() => goTo(prevId)} disabled={!prevId}
            className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Previous lead">
            <ChevronLeft className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(nextId)} disabled={!nextId}
            className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Next lead">
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
          </button>
        </div>

        {/* Start/re-engage a chat — pre-filled with this lead's own number,
            so re-typing what's already on screen isn't needed. Still
            editable, e.g. for the contact's alternate phone instead. */}
        <span className="hidden sm:inline-flex">
          <NewChatDialog
            className="flex items-center justify-center h-8 w-8 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0"
            initialPhone={phone ?? undefined}
            initialName={lead.contact?.name ?? undefined}
          />
        </span>

        <button type="button" onClick={() => setCloseDialogOpen(true)}
          className="hidden sm:flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-rose-50 text-rose-700 text-[12px] font-semibold hover:bg-rose-100 shrink-0">
          Close lead
        </button>

        {/* Phone: every header action in one menu. Always mounted and shown
            with CSS: New chat owns its popup, which unmounting the menu
            would destroy (the Inbox More menu does the same). */}
        <div className="relative shrink-0 sm:hidden">
          <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-label="More actions" aria-expanded={moreOpen} aria-haspopup="menu"
            className={cn("flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100", moreOpen && "bg-slate-100")}>
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {moreOpen && <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreOpen(false)} />}
          <div role="menu" aria-label="Lead actions"
            className={cn("absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl",
              moreOpen ? "visible opacity-100" : "invisible pointer-events-none opacity-0")}>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); void saveDetails() }} disabled={savingDetails}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
              {savingDetails ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden="true" /> : <Check className="h-4 w-4 text-indigo-600" aria-hidden="true" />} Save changes
            </button>
            <NewChatDialog
              label="New chat"
              onOpen={() => setMoreOpen(false)}
              initialPhone={phone ?? undefined}
              initialName={lead.contact?.name ?? undefined}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
            />
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); goTo(prevId) }} disabled={!prevId}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4 text-slate-500" aria-hidden="true" /> Previous lead
            </button>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); goTo(nextId) }} disabled={!nextId}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" /> Next lead
            </button>
            <div className="mx-3 my-1 border-t border-slate-100" />
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setCloseDialogOpen(true) }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-50">
              <X className="h-4 w-4" aria-hidden="true" /> Close lead
            </button>
          </div>
        </div>

        <button type="button" onClick={saveDetails} disabled={savingDetails} title="Save lead details"
          className="hidden sm:flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-60 shrink-0">
          {savingDetails ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />} Save
        </button>
      </div>

      {/* Body — left: scrollable lead workspace, right: fixed WhatsApp chat */}
      {/* Wide screens: the details scroll on the left, the chat stays on
          the right. Narrower: one page that scrolls, the chat below the
          details at a height it can be used at — not two half screens. */}
      <div className="flex-1 overflow-y-auto xl:overflow-hidden xl:grid xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="p-3 sm:p-6 space-y-4 xl:overflow-y-auto">
          {/* Contact hero card */}
          {/* One row when the card is wide; on a phone: name and actions,
              then the numbers, then who it is assigned to. Sized by the
              card itself (container query), since the chat panel beside
              it changes how wide it gets. */}
          <div className="@container rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 @3xl:flex-nowrap">
              {/* Avatar, with the score as a badge on its corner */}
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-[20px] font-black text-white @3xl:h-14 @3xl:w-14 @3xl:text-[22px]">
                  {displayName.slice(0, 1).toUpperCase()}
                </div>
                {scoreIndex >= 0 && (
                  <span
                    title={`${scoreOptions[scoreIndex].label} lead`}
                    className={cn("absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-bold text-slate-700 shadow-sm ring-2 ring-white",
                      SCORE_BADGE[scoreTone(scoreIndex, scoreOptions.length)])}
                  >
                    <span aria-hidden="true">{scoreOptions[scoreIndex].icon || scoreOptions[scoreIndex].label.slice(0, 1).toUpperCase()}</span>
                    <span className="sr-only">{scoreOptions[scoreIndex].label} lead</span>
                  </span>
                )}
              </div>

              <span aria-hidden="true" className="hidden h-10 w-px shrink-0 bg-slate-200 @3xl:block" />

              <div className="min-w-0 flex-1 @3xl:flex-none">
                <h1 className="truncate text-[18px] font-bold text-slate-900 @3xl:text-[20px]">{displayName}</h1>
                {(lead.district || lead.place) && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-slate-400">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {[lead.place, lead.district].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>

              {/* On a phone: call and edit stay beside the name */}
              <div className="flex shrink-0 items-center gap-2 @3xl:hidden">
                {phone && (
                  <a href={`tel:${phone}`} aria-label={`Call ${phone}`} className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}
                <button type="button" onClick={openContactEdit} disabled={!contactId || contactEditLoading} title="Edit contact" aria-label="Edit contact"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                  {contactEditLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
                </button>
                <RecordHistoryButton targetType="lead" targetId={String(lead.id)} className="h-10 min-w-10 rounded-xl" iconOnlyOnPhone />
              </div>

              {/* The numbers: the main one copies, the other one calls */}
              {(phone || altPhone) && (
                <div className="flex w-full flex-wrap items-center gap-1.5 @md:gap-2 @3xl:w-auto @3xl:flex-nowrap">
                  {phone && (
                    <button type="button" onClick={() => copyPhone(phone)} title="Copy number" aria-label={`Copy ${phone}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 text-[12.5px] font-bold tabular-nums text-indigo-900 hover:bg-indigo-200 @md:px-4 @md:text-[14px]">
                      {phone}
                      {copied === phone && <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="Copied" />}
                    </button>
                  )}
                  {altPhone && (
                    <a href={`tel:${altPhone}`} title="Call the other number" aria-label={`Call the other number ${altPhone}`}
                      className="inline-flex h-9 items-center rounded-full bg-slate-100 px-2.5 text-[12.5px] font-medium tabular-nums text-slate-600 hover:bg-slate-200 @md:px-4 @md:text-[14px]">
                      {altPhone}
                    </a>
                  )}
                </div>
              )}

              <span aria-hidden="true" className="hidden h-10 w-px shrink-0 bg-slate-200 @3xl:ml-auto @3xl:block" />

            <div className={cn("items-center gap-2 @3xl:flex @3xl:w-auto", canViewAllLeads && teamMembers.length > 0 ? "flex w-full" : "hidden")}>
              {canViewAllLeads && teamMembers.length > 0 && (
                <select
                  aria-label="Assign this lead to"
                  disabled={assigning}
                  value={lead.assigned_to ?? ""}
                  onChange={async (e) => {
                    const to = e.target.value || null
                    if (assigning || to === (lead.assigned_to ?? null)) return
                    setAssigning(true)
                    try {
                      await apiFetch("/api/leads/bulk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ids: [lead.id], assigned_to: to, also_assign_chat: true }),
                      })
                      const who = teamMembers.find((m) => m.user_id === to)
                      toast.success(to ? `Assigned to ${who?.full_name || who?.email || "them"}` : "Returned to the pool")
                      loadLead()
                      loadChat()
                    } catch (err) {
                      console.error("[lead] assign failed:", err)
                      toast.error(errorText(err, "Could not assign this lead."))
                    } finally {
                      setAssigning(false)
                    }
                  }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-700 @3xl:w-48 @3xl:flex-none"
                >
                  <option value="">Unassigned (pool)</option>
                  {teamMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                  ))}
                </select>
              )}
              {/* Wide card: Call and Edit at the end of the row */}
              {phone && (
                <a href={`tel:${phone}`} className="hidden h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[14px] font-semibold text-white hover:bg-emerald-700 @3xl:inline-flex">
                  <Phone className="h-4 w-4" aria-hidden="true" /> Call
                </a>
              )}
              <button type="button" onClick={openContactEdit} disabled={!contactId || contactEditLoading} title="Edit contact" aria-label="Edit contact"
                className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 @3xl:flex">
                {contactEditLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
              </button>
              <span className="hidden @3xl:inline-flex">
                <RecordHistoryButton targetType="lead" targetId={String(lead.id)} className="h-10 rounded-xl" />
              </span>
            </div>
            </div>
          </div>

          {/* What this lead is for and what they need — right under who
              they are, so nobody has to scroll the timeline to find out. */}
          <LeadDescription
            value={lead.notes ?? ""}
            suggestion={lead.ai_reason ?? null}
            onSave={(notes) => patchLead({ notes })}
          />

          {/* Scheduled calls, and Done / Reschedule / Couldn't reach on each. */}
          <LeadFollowUps
            items={(lead as Lead & { follow_ups?: LeadFollowUp[] }).follow_ups ?? []}
            onChanged={loadLead}
            unclaimed={!lead.assigned_to}
          />

          {/* Lead Details + Log Call Outcome */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Lead Details */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Lead details</h2>
                <GenderBadge gender={lead.contact?.gender} />
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="lead-district" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">District</label>
                  {districts.length > 0 ? (
                    <select id="lead-district" value={district} onChange={(e) => { setDistrict(e.target.value); dirtyRef.current = true }}
                      className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400">
                      <option value="">Choose a district…</option>
                      {district && !districts.includes(district) && <option value={district}>{district}</option>}
                      {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <input id="lead-district" name="lead-district" autoComplete="off" maxLength={60} value={district}
                      onChange={(e) => { setDistrict(e.target.value); dirtyRef.current = true }} placeholder="District or area"
                      className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="lead-place" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Place / area</label>
                  <input id="lead-place" name="lead-place" autoComplete="off" maxLength={120} value={place} onChange={(e) => { setPlace(e.target.value); dirtyRef.current = true }}
                    placeholder="City / area"
                    className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                </div>
                {contactId && (
                  <div className="grid grid-cols-[6rem_1fr] gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="lead-age" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Age</label>
                      <input id="lead-age" type="number" inputMode="numeric" min={0} max={120} step={1} autoComplete="off"
                        value={age} onChange={(e) => { setAge(e.target.value); dirtyRef.current = true }} placeholder="—"
                        className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <label htmlFor="lead-address" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Address</label>
                      <input id="lead-address" autoComplete="street-address" maxLength={500}
                        value={address} onChange={(e) => { setAddress(e.target.value); dirtyRef.current = true }} placeholder="House, street, town"
                        className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <p id="lead-score-label" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Lead score
                    <span className="ml-1.5 font-medium normal-case tracking-normal text-slate-700">
                      · {scoreIndex >= 0 ? scoreOptions[scoreIndex].label : "not set"}
                    </span>
                  </p>
                  {/* Coldest first, so the row reads cold → warm → hot. */}
                  <div role="group" aria-labelledby="lead-score-label" className="grid gap-2"
                    style={{ gridTemplateColumns: `repeat(${Math.min(scoreOptions.length, 4)}, minmax(0, 1fr))` }}>
                    {scoreOptions.map((o, i) => ({ o, tone: scoreTone(i, scoreOptions.length) })).reverse().map(({ o, tone }) => {
                      const on = sameScore(lead.score, o.label)
                      let mark: React.ReactNode = o.icon ? <span aria-hidden="true">{o.icon}</span> : null
                      if (on) mark = <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      if (savingScore === o.label) mark = <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      return (
                        <button key={o.label} type="button" aria-pressed={on} onClick={() => void setScore(o.label)} disabled={savingScore !== null}
                          className={cn("h-9 min-w-0 rounded-xl border px-1 text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-70",
                            on ? SCORE_ACTIVE[tone] : SCORE_INACTIVE[tone])}>
                          {mark}
                          <span className="truncate">{o.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <LeadTags contactId={contactId} />
                </div>
                {/* Notes — same list/expand/delete UX as the Inbox contact sidebar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setNotesOpen((v) => !v)} disabled={!contactId}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-700 disabled:opacity-50">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Notes
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{contactNotes.length}</span>
                    </button>
                    <button type="button" onClick={() => setNewNoteOpen((v) => !v)} disabled={!contactId}
                      aria-label={newNoteOpen ? "Cancel the new note" : "Add a note"} aria-expanded={newNoteOpen}
                      className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
                        newNoteOpen ? "bg-indigo-100 text-indigo-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700")}>
                      {newNoteOpen ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  </div>

                  {newNoteOpen && (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
                      <textarea autoComplete="off" rows={3} maxLength={4000} value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)}
                        aria-label="New note" placeholder="Write a note…"
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
                              <p className="min-w-0 break-words text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">{note.note_text}</p>
                              <button type="button" onClick={() => void deleteNote(note.id)}
                                aria-label="Delete note"
                                className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 transition-opacity focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/note:opacity-100">
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-700">
                              {note.created_by_name && <span className="font-semibold text-amber-700">{note.created_by_name}</span>}
                              {note.created_by_role && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                                  {ROLE_LABEL[note.created_by_role] ?? note.created_by_role}
                                </span>
                              )}
                              <span>{formatInZone(note.created_at, zone, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
                <button type="button" onClick={saveDetails} disabled={savingDetails}
                  className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2">
                  {savingDetails && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {savingDetails ? "Saving…" : "Save changes"}
                </button>
                <div className="pt-2 border-t border-slate-100 space-y-0.5">
                  <p className="text-[11px] text-slate-500">Created {formatInZone(lead.created_at, zone)}</p>
                  <p className="text-[11px] text-slate-500">Updated {formatInZone(lead.updated_at, zone)}</p>
                </div>
              </div>
            </div>

            {/* One column: log the call first, then the stage it reached.
                As tall as the Lead Details card beside it: the last card
                stretches, so no gap is left under the column. */}
            <div className="flex flex-col gap-4 [&>*:last-child]:flex-1">
              {/* Log Call Outcome */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-4">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Log call outcome
                </h2>

                {/* Mode switch — only one of Connected / Call Not Connected is
                    editable at a time, chosen here instead of both being
                    simultaneously live. */}
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <label className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 transition-all",
                    callMode === "connected" ? "border-emerald-400 bg-emerald-50" : "border-slate-100 bg-white hover:border-emerald-200",
                  )}>
                    <input autoComplete="off" type="radio" name="call-mode" checked={callMode === "connected"}
                      onChange={() => setCallMode("connected")} className="accent-emerald-500" />
                    <span className={cn("text-[12.5px] font-bold", callMode === "connected" ? "text-emerald-700" : "text-slate-500")}>Connected</span>
                  </label>
                  <label className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 transition-all",
                    callMode === "not_connected" ? "border-rose-400 bg-rose-50" : "border-slate-100 bg-white hover:border-rose-200",
                  )}>
                    <input autoComplete="off" type="radio" name="call-mode" checked={callMode === "not_connected"}
                      onChange={() => setCallMode("not_connected")} className="accent-rose-500" />
                    <span className={cn("text-[12.5px] font-bold", callMode === "not_connected" ? "text-rose-700" : "text-slate-500")}>Not connected</span>
                  </label>
                </div>

                {callMode === "connected" ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 space-y-2.5">
                    <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-700">
                      <Phone className="h-4 w-4" aria-hidden="true" /> Connected
                    </p>
                    <select aria-label="Outcome of the connected call" value={connectedChoice} onChange={(e) => setConnectedChoice(e.target.value)}
                      className="w-full h-9 rounded-xl border border-emerald-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100">
                      <option value="">Choose outcome…</option>
                      {CONNECTED_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <button onClick={recordConnected} disabled={!connectedChoice || recording !== null}
                      className="w-full h-10 rounded-xl bg-emerald-500 text-white text-[13px] font-bold hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                      {recording === "connected" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Record outcome
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 space-y-2.5">
                    <p className="flex items-center gap-2 text-[13px] font-bold text-rose-700">
                      <PhoneOff className="h-4 w-4" aria-hidden="true" /> Not connected
                    </p>
                    <select aria-label="Why the call did not connect" value={notConnectedChoice} onChange={(e) => setNotConnectedChoice(e.target.value)}
                      className="w-full h-9 rounded-xl border border-rose-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-100">
                      <option value="">Choose reason…</option>
                      {NOT_CONNECTED_REASONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <button onClick={recordNotConnected} disabled={!notConnectedChoice || recording !== null}
                      className="w-full h-10 rounded-xl bg-rose-500 text-white text-[13px] font-bold hover:bg-rose-600 disabled:opacity-50 flex items-center justify-center gap-2">
                      {recording === "not_connected" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Record outcome
                    </button>
                  </div>
                )}
              </div>

              {/* The business's own funnel stage; hidden until stages are set up. */}
              <LeadStageCard leadId={id} onChanged={loadLead} />
            </div>

            {/* Which ad brought this lead in; hidden when none did. */}
            <LeadAdCard leadId={id} />

          </div>

          {/* Timeline — below the grid, reached by scrolling */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Timeline</h2>
            <LeadActivityTimeline activities={activities} isClosed={lead.status === "closed"} onItemClick={contactId ? jumpToDate : undefined} />
          </div>
        </div>

        {/* WhatsApp Chat panel */}
        <section aria-label="Chat" className="flex h-[85dvh] min-h-[28rem] flex-col overflow-hidden border-t border-slate-200 bg-white xl:h-auto xl:min-h-0 xl:border-l xl:border-t-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
            <MessageSquare className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">{channelName} chat</h2>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white text-[12px] font-bold">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-800 truncate">{displayName}</p>
              <p className="text-[11px] text-slate-500">{channelName}</p>
            </div>
            <button type="button" onClick={loadChat} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100 shrink-0" title="Refresh the chat" aria-label="Refresh the chat">
              <RefreshCw className={cn("h-3.5 w-3.5 text-slate-500", chatLoading && "animate-spin")} aria-hidden="true" />
            </button>
            <Link href={conversationId ? `/inbox?c=${conversationId}` : "/inbox"}
              className="flex items-center gap-1 shrink-0 h-7 px-2.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <ExternalLink className="h-3 w-3" aria-hidden="true" /> Inbox
            </Link>
          </div>

          {/* Same WhatsApp-style doodle wallpaper as the main Inbox thread
              (bg-[url('/inbox-doodle.svg')]) — this panel previously used a
              flat colour instead of matching the shared pattern. */}
          {/* ── The chat, behind a decision ──────────────────────────
              An unclaimed lead is offered to everybody, and reading the
              conversation is how two agents end up ringing the same
              customer ten minutes apart — each of them certain nobody
              had, because nothing they did left a mark.

              So the messages wait for somebody to say they are taking
              it. Not to hide anything: every word is one tap away, and
              that tap is what puts a name on the row so the next person
              can see it is handled.

              It also matches what the API already does — changing
              anything on an unassigned lead claims it. This makes that
              rule visible before somebody trips over it, rather than
              surprising them with an assignment they did not know they
              were making. */}
          {!lead.assigned_to ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-white bg-[url('/inbox-doodle.svg')] bg-repeat px-6 text-center">
              <div className="rounded-2xl bg-white/90 px-5 py-6 shadow-sm ring-1 ring-slate-200">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-indigo-50">
                  <MessageSquare className="h-5 w-5 text-indigo-500" />
                </div>
                <p className="mt-3 text-[13.5px] font-semibold text-slate-800">
                  Pick this lead to see the chat
                </p>
                <p className="mx-auto mt-1 max-w-[15rem] text-[12px] leading-relaxed text-slate-500">
                  Nobody has taken this one yet. Picking it puts your name on it, so somebody else
                  does not call the same person.
                </p>
                <button
                  type="button"
                  onClick={pickLead}
                  disabled={picking || !userId}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {picking && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  Pick this lead
                </button>
                <p className="mt-2.5 text-[11px] text-slate-400">
                  Editing anything on this lead picks it up too.
                </p>
              </div>
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto bg-white bg-[url('/inbox-doodle.svg')] bg-repeat p-4 space-y-2">
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
          )}

          {/* The composer goes with the chat. Offering a reply box above
              a panel that will not show the conversation would be
              offering somebody the chance to answer a customer they
              cannot read. */}
          {lead.assigned_to && (
          <div className="border-t border-slate-100 p-3 shrink-0">
            <input autoComplete="off" ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" />

            {sessionExpired && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
                <p className="text-xs text-amber-700">
                  24-hour session expired. Use a template to re-engage.
                </p>
                <button type="button" onClick={() => setTemplatePickerOpen(true)}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-amber-700 hover:bg-amber-500/10 hover:text-amber-800">
                  <LayoutTemplate className="h-3 w-3" />
                  Templates
                </button>
              </div>
            )}

            {/* Phone: the message box gets the whole first row, the buttons sit under it. */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-nowrap">
              <EmojiPickerPopover onSelect={insertEmoji} disabled={!conversationId || sessionExpired} />
              {conversationId && <ScheduleMenuButton conversationId={conversationId} channel={conversationChannel} />}
              <div className="relative shrink-0">
                <button type="button" onClick={() => setAttachOpen((v) => !v)} disabled={!conversationId || uploading || sessionExpired}
                  aria-label="Attach a file" aria-expanded={attachOpen}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 disabled:opacity-40" title={sessionExpired ? "Session expired — send a template to re-engage first" : "Attach"}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
                </button>
                {attachOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                    <div className="absolute bottom-9 left-0 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                      {!isWebsiteChat && (
                        <>
                          <button type="button" onClick={() => { setAttachOpen(false); setTemplatePickerOpen(true) }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                            <LayoutTemplate className="h-4 w-4 shrink-0 text-amber-500" />
                            Message template
                          </button>
                          <div className="mx-3 my-1 border-t border-slate-100" />
                        </>
                      )}
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">From device</div>
                      {ATTACH_OPTIONS.map(({ key, label, icon: Icon, color, accept }) => (
                        <button key={key} type="button" onClick={() => openFilePicker(accept)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                          <Icon className={cn("h-4 w-4 shrink-0", color)} />
                          {label}
                        </button>
                      ))}
                      <div className="mx-3 my-1 border-t border-slate-100" />
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">From file manager</div>
                      <button type="button" onClick={() => { setAttachOpen(false); setFilePickerOpen(true) }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-slate-800 hover:bg-slate-100 transition-colors">
                        <FolderOpen className="h-4 w-4 shrink-0 text-indigo-500" />
                        Browse files
                      </button>
                    </div>
                  </>
                )}
              </div>
              {/* A real multi-line box: Enter sends, Shift+Enter starts a new line. */}
              <textarea autoComplete="off" rows={1} value={composerText} onChange={(e) => setComposerText(e.target.value)}
                aria-label="Message"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage() } }}
                placeholder={
                  !conversationId
                    ? "No conversation with this person yet"
                    : sessionExpired
                      ? "Session expired — use a template"
                      : "Type a message…"
                }
                disabled={!conversationId || sending || sessionExpired}
                className="order-first max-h-32 min-h-[1.5rem] min-w-0 flex-1 basis-full resize-none bg-transparent py-1 text-[13px] text-slate-800 outline-none [field-sizing:content] disabled:opacity-50 sm:order-none sm:basis-0" />
              <button type="button" onClick={draftReply} disabled={!conversationId || drafting || sessionExpired}
                aria-label="Draft a reply with AI"
                title="Draft a reply from this conversation — you approve it before it sends"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-40">
                {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => void sendMessage()} disabled={!conversationId || !composerText.trim() || sending || sessionExpired}
                aria-label="Send message"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-1 text-right text-[10px] text-slate-500">Enter to send · Shift+Enter for a new line</p>
          </div>
          )}
        </section>
      </div>

      <CloseLeadDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        onConfirm={handleCloseConfirm}
        leadTitle={lead?.title ?? ''}
        contactId={contactId}
      />

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
        conversationId={conversationId ?? undefined}
      />

      <ContactForm
        open={contactEditOpen}
        onOpenChange={setContactEditOpen}
        contact={contactEditData}
        onSaved={() => { setContactEditOpen(false); loadLead() }}
      />
    </div>
  )
}
