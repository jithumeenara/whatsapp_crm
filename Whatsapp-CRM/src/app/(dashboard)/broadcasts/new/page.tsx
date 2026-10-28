"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Radio, Phone } from "lucide-react"
import type { MessageTemplate } from "@/types"
import type { VariableMapping } from "@/lib/broadcasts/resolve-variables"
import { Step1ChooseTemplate } from "@/components/broadcasts/step1-choose-template"
import { Step2SelectAudience, type AudienceConfig } from "@/components/broadcasts/step2-select-audience"
import { Step3Personalize } from "@/components/broadcasts/step3-personalize"
import { Step4ScheduleSend } from "@/components/broadcasts/step4-schedule-send"
import { FollowUpAudience } from "@/components/broadcasts/follow-up-audience"
import { EventTrigger, eventSummaryText } from "@/components/broadcasts/event-trigger"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { useBroadcastSending, type BroadcastSchedule } from "@/hooks/use-broadcast-sending"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const STEPS = [
  { key: "template",    label: "Template" },
  { key: "audience",   label: "Audience" },
  { key: "personalize",label: "Personalize" },
  { key: "send",       label: "Send" },
] as const

export default function NewBroadcastV2() {
  const router = useRouter()
  const { createAndSendBroadcast, isProcessing, progress } = useBroadcastSending()

  const [step, setStep] = useState(0)
  const [template, setTemplate] = useState<MessageTemplate | null>(null)
  const [audience, setAudience] = useState<AudienceConfig>({ type: "all" })
  const [variables, setVariables] = useState<Record<string, VariableMapping>>({})
  const [name, setName] = useState("")
  const [headerMediaUrl, setHeaderMediaUrl] = useState("")
  const [schedule, setSchedule] = useState<BroadcastSchedule>({ type: "now" })
  // Which connected number to send from (Finding #14) — only meaningful
  // once an account has more than one; stays unset (account default)
  // otherwise, so a single-number account sees no new UI at all.
  const [numbers, setNumbers] = useState<{ id: string; label: string }[]>([])
  const [whatsappConfigId, setWhatsappConfigId] = useState<string>("")
  // ?mode=event — an event-based message: step 2 is its trigger, not an audience.
  const [eventMode, setEventMode] = useState(false)
  const [tagNames, setTagNames] = useState<Record<string, string>>({})
  // A follow-up whose first broadcast has not finished can only be automatic.
  const [parentFinished, setParentFinished] = useState(true)

  useEffect(() => {
    fetch("/api/whatsapp/config")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.configs ?? []) as Array<{ id: string; config?: { label?: string | null; phone_number_id: string; is_default: boolean } }>
        setNumbers(list.filter((n) => n.config).map((n) => ({ id: n.id, label: n.config!.label || n.config!.phone_number_id })))
        const def = list.find((n) => n.config?.is_default)
        if (def) setWhatsappConfigId(def.id)
      })
      .catch(() => {})
  }, [])

  // "Send follow-up" on a broadcast's report opens this page with
  // ?followUp=<broadcast id>&outcome=<group>: the audience is that group.
  // Read from location rather than useSearchParams, which would need a
  // Suspense boundary around the whole wizard.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const parentId = q.get("followUp")
    const outcome = q.get("outcome")
    if (!parentId || !outcome) return
    let live = true
    apiFetch(`/api/broadcasts/${encodeURIComponent(parentId)}/outcomes`)
      .then((r) => r.json())
      .then((d: { broadcast?: { name?: string; status?: string }; outcomes?: Array<{ key: string; label: string; followUp: boolean }> }) => {
        if (!live) return
        const group = d.outcomes?.find((o) => o.key === outcome && o.followUp)
        if (!group) { toast.error("That group can't get a follow-up."); return }
        const parentName = d.broadcast?.name ?? "broadcast"
        const finished = d.broadcast?.status === "sent" || d.broadcast?.status === "failed" || d.broadcast?.status === "active"
        setParentFinished(finished)
        if (!finished) setSchedule({ type: "after_parent", followUpDelay: { value: 1, unit: "days" }, sendWindow: "09:00-21:00" })
        setAudience({ type: "broadcast_outcome", fromBroadcast: { broadcastId: parentId, outcome }, label: `${group.label} · ${parentName}` })
        setName((n) => n || `${parentName} — follow-up (${group.label.toLowerCase()})`.slice(0, 120))
      })
      .catch((err) => {
        console.error("[broadcast] follow-up group failed to load:", err)
        if (live) toast.error(errorText(err, "Could not load the group for this follow-up."))
      })
    return () => { live = false }
  }, [])

  // ?mode=event and ?list=<id> (Lists → "Send to list").
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get("mode") === "event") {
      // Switched on once the tag names are in (step 0, the template, is
      // the same in both modes, so nothing visible waits on it).
      apiFetch("/api/tags", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { tags?: { id: string; name: string }[] }) => setTagNames(Object.fromEntries((d.tags ?? []).map((t) => [t.id, t.name]))))
        .catch((err) => console.error("[broadcast] tags failed to load:", err))
        .finally(() => {
          setEventMode(true)
          setSchedule({ type: "event", event: { trigger: "tag_added", tagId: "", delayValue: 0, delayUnit: "minutes", includeExisting: false }, sendWindow: "09:00-21:00" })
        })
      return
    }
    const listId = q.get("list")
    if (!listId) return
    let live = true
    apiFetch(`/api/contact-lists/${encodeURIComponent(listId)}`)
      .then((r) => r.json())
      .then((d: { list?: { id: string; name: string } }) => {
        if (live && d.list) setAudience({ type: "list", listId: d.list.id, label: d.list.name })
      })
      .catch((err) => {
        console.error("[broadcast] list failed to load:", err)
        if (live) toast.error(errorText(err, "Could not load that list."))
      })
    return () => { live = false }
  }, [])

  function handleSelectTemplate(t: MessageTemplate) {
    if (template?.id !== t.id) setHeaderMediaUrl("") // new template -> old media override no longer applies
    setTemplate(t)
  }

  async function handleSend() {
    if (!template) return
    try {
      const id = await createAndSendBroadcast({ name, template, audience: { type: audience.type, table: audience.table, tagIds: audience.tagIds, tagMatch: audience.tagMatch, customField: audience.customField, csvContacts: audience.csvContacts, contactIds: audience.contactIds, excludeTagIds: audience.excludeTagIds, fromBroadcast: audience.fromBroadcast, listId: audience.listId, listIds: audience.listIds, engagement: audience.engagement }, variables, headerMediaUrl: headerMediaUrl || undefined, schedule, whatsappConfigId: whatsappConfigId || undefined })
      toast.success(
        schedule.type === "now" ? "Broadcast sending…"
          : schedule.type === "once" ? "Broadcast scheduled"
          : schedule.type === "event" ? "Event-based message is on"
          : schedule.type === "after_parent" ? "Follow-up set up — it goes by itself"
          : "Recurring broadcast started",
      )
      router.push(`/broadcasts/${id}`)
    } catch (err) {
      console.error("[broadcast] create failed:", err)
      toast.error(errorText(err, "Broadcast failed"))
    }
  }

  async function handleSaveDraft() {
    if (!template || !name.trim()) { toast.error("Give the broadcast a name before saving a draft."); return }
    const res = await fetch("/api/broadcasts/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), template_name: template.name, template_language: template.language ?? "en_US", template_variables: variables, header_media_url: headerMediaUrl || undefined, whatsapp_config_id: whatsappConfigId || undefined, audience_filter: { type: audience.type, tagIds: audience.tagIds, tagMatch: audience.tagMatch, excludeTagIds: audience.excludeTagIds, fromBroadcast: audience.fromBroadcast, listId: audience.listId, listIds: audience.listIds } }),
    })
    if (!res.ok) { const b = await res.json().catch(() => ({})); toast.error(`Failed: ${b?.error ?? `HTTP ${res.status}`}`); return }
    toast.success("Draft saved"); router.push("/broadcasts")
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-900">{eventMode ? "New event-based message" : "New broadcast"}</h1>
            <p className="text-[11px] text-slate-500">{eventMode ? "Sent by itself when a tag is added or removed" : "Send a message to multiple contacts"}</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="mt-4 flex items-center gap-0">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-all sm:h-7 sm:w-7 sm:text-[11px]",
                    done ? "bg-indigo-600 text-white" : active ? "border-2 border-indigo-600 bg-indigo-50 text-indigo-700" : "border border-slate-300 bg-white text-slate-400")}>
                    {done ? <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : i + 1}
                  </div>
                  <span className={cn("hidden text-[12px] font-medium sm:block", active ? "text-slate-900" : done ? "text-indigo-600" : "text-slate-400")}>
                    {eventMode && s.key === "audience" ? "Trigger" : s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn("mx-2 h-px flex-1 sm:mx-3", i < step ? "bg-indigo-600" : "bg-slate-200")} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div style={{ opacity: isProcessing ? 0.6 : 1, pointerEvents: isProcessing ? "none" : "auto" }} className="transition-opacity">
          {step === 0 && <Step1ChooseTemplate selectedTemplate={template} onSelect={handleSelectTemplate} onNext={() => setStep(1)} onBack={() => router.push("/broadcasts")} />}
          {step === 1 && eventMode && (
            <EventTrigger schedule={schedule} onChange={setSchedule} onNext={() => setStep(2)} onBack={() => setStep(0)} />
          )}
          {step === 1 && !eventMode && audience.type === "broadcast_outcome" && (
            <FollowUpAudience audience={audience} parentFinished={parentFinished}
              onChangeAudience={() => { setAudience({ type: "all" }); setSchedule({ type: "now" }); setParentFinished(true) }}
              onNext={() => setStep(2)} onBack={() => setStep(0)} />
          )}
          {step === 1 && !eventMode && audience.type !== "broadcast_outcome" && <Step2SelectAudience audience={audience} onUpdate={setAudience} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
          {step === 2 && template && <Step3Personalize template={template} headerMediaUrl={headerMediaUrl} onHeaderMediaChange={setHeaderMediaUrl} variables={variables} onUpdate={setVariables} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && template && numbers.length > 1 && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
              <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                <Phone className="h-3.5 w-3.5" />
                Send from
              </label>
              <select
                value={whatsappConfigId}
                onChange={(e) => setWhatsappConfigId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
          )}
          {step === 3 && template && <Step4ScheduleSend name={name} onNameChange={setName} template={template}
            audience={eventMode ? { type: "event" } : audience} schedule={schedule}
            mode={eventMode ? "event" : audience.type === "broadcast_outcome" ? "follow_up" : "normal"}
            parentFinished={parentFinished}
            eventSummary={eventMode ? eventSummaryText(schedule, tagNames[schedule.event?.tagId ?? ""]) : undefined} onScheduleChange={setSchedule} onSend={handleSend} onSaveDraft={eventMode || audience.type === "broadcast_outcome" ? undefined : handleSaveDraft} onBack={() => setStep(2)} isProcessing={isProcessing} progress={progress} />}
        </div>
      </div>
    </div>
  )
}
