"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Radio } from "lucide-react"
import type { MessageTemplate } from "@/types"
import { Step1ChooseTemplate } from "@/components/broadcasts/step1-choose-template"
import { Step2SelectAudience } from "@/components/broadcasts/step2-select-audience"
import { Step3Personalize } from "@/components/broadcasts/step3-personalize"
import { Step4ScheduleSend } from "@/components/broadcasts/step4-schedule-send"
import { useBroadcastSending } from "@/hooks/use-broadcast-sending"

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
  const [audience, setAudience] = useState<{
    type: "all" | "tags" | "custom_field" | "csv" | "contacts"
    tagIds?: string[]
    customField?: { fieldId: string; operator: "is" | "is_not" | "contains"; value: string }
    csvContacts?: { phone: string; name?: string }[]
    contactIds?: string[]
    excludeTagIds?: string[]
  }>({ type: "all" })
  const [variables, setVariables] = useState<Record<string, { type: "static" | "field" | "custom_field"; value: string }>>({})
  const [name, setName] = useState("")

  async function handleSend() {
    if (!template) return
    try {
      const id = await createAndSendBroadcast({ name, template, audience: { type: audience.type, tagIds: audience.tagIds, customField: audience.customField, csvContacts: audience.csvContacts, contactIds: audience.contactIds, excludeTagIds: audience.excludeTagIds }, variables })
      router.push(`/broadcasts/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Broadcast failed")
    }
  }

  async function handleSaveDraft() {
    if (!template || !name.trim()) { toast.error("Give the broadcast a name before saving a draft."); return }
    const res = await fetch("/api/broadcasts/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), template_name: template.name, template_language: template.language ?? "en_US", template_variables: variables, audience_filter: { type: audience.type, tagIds: audience.tagIds } }),
    })
    if (!res.ok) { const b = await res.json().catch(() => ({})); toast.error(`Failed: ${b?.error ?? `HTTP ${res.status}`}`); return }
    toast.success("Draft saved"); router.push("/broadcasts")
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
            <Radio className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-slate-900">New Broadcast</h1>
            <p className="text-[11px] text-slate-500">Send a message to multiple contacts</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="mt-4 flex items-center gap-0">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex items-center gap-2">
                  <div className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all",
                    done ? "bg-indigo-600 text-white" : active ? "border-2 border-indigo-600 bg-indigo-50 text-indigo-700" : "border border-slate-300 bg-white text-slate-400")}>
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={cn("hidden text-[12px] font-medium sm:block", active ? "text-slate-900" : done ? "text-indigo-600" : "text-slate-400")}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn("mx-3 h-px flex-1", i < step ? "bg-indigo-600" : "bg-slate-200")} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 mx-auto max-w-3xl">
        <div style={{ opacity: isProcessing ? 0.6 : 1, pointerEvents: isProcessing ? "none" : "auto" }} className="transition-opacity">
          {step === 0 && <Step1ChooseTemplate selectedTemplate={template} onSelect={setTemplate} onNext={() => setStep(1)} onBack={() => router.push("/broadcasts")} />}
          {step === 1 && <Step2SelectAudience audience={audience} onUpdate={setAudience} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
          {step === 2 && template && <Step3Personalize template={template} variables={variables} onUpdate={setVariables} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && template && <Step4ScheduleSend name={name} onNameChange={setName} template={template} audience={audience} onSend={handleSend} onSaveDraft={handleSaveDraft} onBack={() => setStep(2)} isProcessing={isProcessing} progress={progress} />}
        </div>
      </div>
    </div>
  )
}
