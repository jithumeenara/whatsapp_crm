"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, MessageSquare, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { Lead, LeadActivity, Message } from "@/types"
import { LeadDetailForm } from "@/components/leads/lead-detail-form"
import { CallActionPanel } from "@/components/leads/call-action-panel"
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline"
import { MessageBubble } from "@/components/inbox/message-bubble"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const SCORE_COLOR: Record<string, string> = {
  hot: "bg-rose-100 text-rose-700",
  warm: "bg-amber-100 text-amber-700",
  cold: "bg-sky-100 text-sky-700",
}

type ListItem = { icon: string; label: string }

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromTab = searchParams.get("from") ?? "all"

  const [lead, setLead] = useState<Lead | null>(null)
  const [prevId, setPrevId] = useState<string | null>(null)
  const [nextId, setNextId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [scoringMode, setScoringMode] = useState("score")
  const [leadSources, setLeadSources] = useState<ListItem[] | undefined>(undefined)

  const [activities, setActivities] = useState<LeadActivity[]>([])

  const [messages, setMessages] = useState<Message[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [channelCount, setChannelCount] = useState<number | null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const loadLead = useCallback(() => {
    // Deliberately doesn't set loading=true here — the initial useState(true)
    // covers the first mount's skeleton, and re-fetches triggered by
    // patchLead() should update data silently in the background rather
    // than flashing the whole page back to a loading skeleton.
    fetch(`/api/leads/${id}?from=${encodeURIComponent(fromTab)}`)
      .then((r) => r.json())
      .then((d) => {
        setLead(d.lead ?? null)
        setPrevId(d.prevId ?? null)
        setNextId(d.nextId ?? null)
        setActivities(d.lead?.activities ?? [])
      })
      .catch(() => toast.error("Failed to load lead"))
      .finally(() => setLoading(false))
  }, [id, fromTab])

  useEffect(() => { loadLead() }, [loadLead])

  // Lead settings — scoring mode + lead source list, same source of truth as the leads list page
  useEffect(() => {
    fetch("/api/leads/settings")
      .then((r) => r.json())
      .then((d) => {
        setScoringMode(d.scoring_mode ?? "score")
        if (Array.isArray(d.lead_sources) && d.lead_sources.length > 0) setLeadSources(d.lead_sources)
      })
      .catch(() => {})
  }, [])

  // Embedded chat history — merged across every channel this contact has a
  // conversation on (same endpoint/shape the inbox's own "full history"
  // view already uses). Read-only: composing/replying happens in the Inbox.
  const contactId = lead?.contact_id ?? lead?.contact?.id ?? null
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!contactId) {
        if (!cancelled) { setMessages([]); setChannelCount(null) }
        return
      }
      setChatLoading(true)
      try {
        const res = await fetch(`/api/contacts/${contactId}/timeline`)
        const d = await res.json()
        if (!cancelled) {
          setMessages(Array.isArray(d.messages) ? d.messages : [])
          setChannelCount(Array.isArray(d.channels) ? d.channels.length : null)
        }
      } catch {
        // ignore — chat panel just stays empty
      } finally {
        if (!cancelled) setChatLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [contactId])

  const patchLead = useCallback(async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      toast.error("Failed to save changes")
      return
    }
    const body = await res.json()
    setLead((prev) => prev ? { ...prev, ...body.lead } : body.lead)
    loadLead() // refresh activities/timeline too
  }, [id, loadLead])

  // Debounced auto-save for free-typed LeadDetailForm fields (district/place/
  // notes etc.) — instant per-field PATCH would spam the API on every
  // keystroke; call actions below save immediately since they're discrete clicks.
  const pendingPatchRef = useRef<Record<string, unknown>>({})
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleFormChange = useCallback((patch: Partial<Lead>) => {
    setLead((prev) => prev ? { ...prev, ...patch } : prev)
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const toSave = pendingPatchRef.current
      pendingPatchRef.current = {}
      void patchLead(toSave)
    }, 800)
  }, [patchLead])

  async function deleteLead() {
    if (!confirm("Delete this lead?")) return
    await fetch(`/api/leads/${id}`, { method: "DELETE" })
    toast.success("Lead deleted")
    router.push("/leads")
  }

  function goTo(targetId: string | null) {
    if (!targetId) return
    router.push(`/leads/${targetId}?from=${encodeURIComponent(fromTab)}`)
  }

  function jumpToDate(dateKey: string) {
    // Find the first message on/after this date and scroll it into view.
    const target = messages.find((m) => new Date(m.created_at).toISOString().slice(0, 10) >= dateKey)
    if (!target) { toast.info("No messages around that date"); return }
    const el = messageRefs.current.get(target.id)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
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

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100 shrink-0">
        <button onClick={() => router.push("/leads")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-bold text-slate-800 truncate">{lead.title}</h1>
            {lead.score && (
              <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize", SCORE_COLOR[lead.score] ?? "bg-slate-100 text-slate-600")}>
                {lead.score}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-400">Lead · {lead.status?.replace(/_/g, " ") ?? "New"}</p>
        </div>

        {/* Prev/Next within the same tab ordering the user came from */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => goTo(prevId)} disabled={!prevId}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronLeft className="h-4 w-4 text-slate-500" />
          </button>
          <button onClick={() => goTo(nextId)} disabled={!nextId}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
            <ChevronRight className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <button onClick={deleteLead} className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-200 text-rose-500 text-[12px] font-medium hover:bg-rose-50 shrink-0">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>

      {/* Body — 3 columns: lead info + call actions | chat window | activity timeline */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[360px_1fr_320px]">
        {/* Left: editable lead details + call action panel */}
        <div className="overflow-y-auto border-r border-slate-100 p-5 space-y-5">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Lead Details</p>
            <LeadDetailForm lead={lead} scoringMode={scoringMode} sources={leadSources} onChange={handleFormChange} />
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Call Action</p>
            <CallActionPanel leadId={lead.id} currentStatus={lead.status} onAction={patchLead} />
          </div>
        </div>

        {/* Middle: embedded chat window (read-only history, reply happens in Inbox) */}
        <div className="flex flex-col overflow-hidden border-r border-slate-100 bg-[#EFEAE2]">
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-white border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-[13px] font-semibold text-slate-700 truncate">
                {lead.contact?.name || lead.contact?.phone || "Chat"}
              </span>
              {channelCount !== null && channelCount > 1 && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {channelCount} channels
                </span>
              )}
            </div>
            <button onClick={() => router.push("/inbox")}
              className="flex items-center gap-1 shrink-0 text-[12px] font-medium text-indigo-600 hover:text-indigo-800">
              Open in Inbox <ExternalLink className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!contactId ? (
              <p className="text-center text-[13px] text-slate-400 mt-8">This lead has no linked contact.</p>
            ) : chatLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-white/60 rounded-xl animate-pulse" />)}
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-[13px] text-slate-400 mt-8">No messages yet.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} ref={(el) => { if (el) messageRefs.current.set(m.id, el); else messageRefs.current.delete(m.id) }}
                  className="flex">
                  <MessageBubble message={m} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: activity timeline — click an event to jump to that date in the chat */}
        <div className="overflow-y-auto p-5">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Timeline</p>
            <LeadActivityTimeline
              activities={activities}
              isClosed={lead.status === "closed"}
              onItemClick={contactId ? jumpToDate : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
