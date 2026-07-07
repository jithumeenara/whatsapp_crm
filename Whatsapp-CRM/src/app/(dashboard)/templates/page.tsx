"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  FileText, RefreshCw, Plus, AlertTriangle, ArrowLeft, ChevronRight,
  ImageIcon, VideoIcon, FileIcon, Type, Phone, Link2,
  MessageSquareText, Trash2, Copy, Smartphone, Workflow, Pencil, Eye, X,
  UploadCloud, CheckCircle2,
} from "lucide-react"
import type { MessageTemplate, TemplateButton } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type TCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION"
type TSubtype  = "default" | "flows" | "catalogue" | "order_status" | "order_details" | "calling" | "otp"
type ApiCategory = "Marketing" | "Utility" | "Authentication"

function toApiCategory(c: TCategory): ApiCategory {
  if (c === "UTILITY")        return "Utility"
  if (c === "AUTHENTICATION") return "Authentication"
  return "Marketing"
}
function fromApiCategory(c?: string): TCategory {
  if (c?.toLowerCase() === "utility")        return "UTILITY"
  if (c?.toLowerCase() === "authentication") return "AUTHENTICATION"
  return "MARKETING"
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const LANGUAGES = [
  { code: "en_US", label: "English (US)" }, { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" }, { code: "ml", label: "Malayalam" },
  { code: "ta", label: "Tamil" }, { code: "kn", label: "Kannada" },
  { code: "te", label: "Telugu" }, { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" }, { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" }, { code: "ar", label: "Arabic" },
  { code: "fr", label: "French" }, { code: "es", label: "Spanish" },
  { code: "de", label: "German" }, { code: "pt_BR", label: "Portuguese (Brazil)" },
  { code: "id", label: "Indonesian" }, { code: "ms", label: "Malay" },
  { code: "th", label: "Thai" }, { code: "vi", label: "Vietnamese" },
  { code: "zh_CN", label: "Chinese (Simplified)" }, { code: "zh_TW", label: "Chinese (Traditional)" },
  { code: "ja", label: "Japanese" }, { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" }, { code: "tr", label: "Turkish" },
  { code: "it", label: "Italian" }, { code: "nl", label: "Dutch" },
  { code: "fil", label: "Filipino" },
]

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  PENDING:  "bg-amber-50 text-amber-700 border-amber-100",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-100",
  PAUSED:   "bg-slate-100 text-slate-600 border-slate-200",
  DRAFT:    "bg-slate-50 text-slate-500 border-slate-200",
}

const CATEGORY_COLOR: Record<TCategory, string> = {
  MARKETING:      "bg-amber-50 text-amber-700 border-amber-200",
  UTILITY:        "bg-blue-50 text-blue-700 border-blue-200",
  AUTHENTICATION: "bg-purple-50 text-purple-700 border-purple-200",
}

const EDITABLE_STATUSES = new Set(["APPROVED", "REJECTED", "PAUSED", "DRAFT"])

const SUBTYPES: Record<TCategory, { id: TSubtype; label: string; desc: string; supported: boolean }[]> = {
  MARKETING: [
    { id: "default",       label: "Default",                     desc: "Send messages with media and customised buttons to engage your customers",      supported: true  },
    { id: "flows",         label: "Flows",                       desc: "Send a form to capture customer interests, appointment requests or run surveys", supported: true  },
    { id: "catalogue",     label: "Catalogue",                   desc: "Send messages that drive sales by connecting your product catalogue",            supported: false },
    { id: "order_details", label: "Order details",               desc: "Send messages through which customers can pay you",                              supported: false },
    { id: "calling",       label: "Calling permissions request", desc: "Ask customers if you can call them on WhatsApp",                                 supported: false },
  ],
  UTILITY: [
    { id: "default",       label: "Default",                     desc: "Send messages about an existing order or account",                              supported: true  },
    { id: "flows",         label: "Flows",                       desc: "Send a form to collect feedback, send reminders or manage orders",               supported: true  },
    { id: "order_status",  label: "Order status",                desc: "Send messages to tell customers about the progress of their orders",             supported: false },
    { id: "order_details", label: "Order details",               desc: "Send messages through which customers can pay you",                              supported: false },
    { id: "calling",       label: "Calling permissions request", desc: "Ask customers if you can call them on WhatsApp",                                 supported: false },
  ],
  AUTHENTICATION: [
    { id: "otp", label: "One-time password", desc: "Send OTP codes to verify customer identity — must be created in Meta Business Manager", supported: false },
  ],
}

const HEADER_TYPES = [
  { v: "",         label: "None" },
  { v: "text",     label: "Text",     icon: <Type      className="h-3.5 w-3.5" /> },
  { v: "image",    label: "Image",    icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { v: "video",    label: "Video",    icon: <VideoIcon className="h-3.5 w-3.5" /> },
  { v: "document", label: "Document", icon: <FileIcon  className="h-3.5 w-3.5" /> },
]

const BUTTON_OPTS: { type: TemplateButton["type"]; label: string; desc: string }[] = [
  { type: "QUICK_REPLY",  label: "Quick Reply",       desc: "One-tap reply" },
  { type: "URL",          label: "Visit Website",     desc: "Opens a URL" },
  { type: "PHONE_NUMBER", label: "Call Phone Number", desc: "Initiates a call" },
  { type: "COPY_CODE",    label: "Copy Offer Code",   desc: "Copies promo code" },
  { type: "FLOW",         label: "Complete Flow",     desc: "Launches a WhatsApp Flow" },
]

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function extractVars(text: string): number[] {
  const set = new Set<number>()
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) { const n = Number(m[1]); if (n >= 1) set.add(n) }
  return [...set].sort((a, b) => a - b)
}
function applyVars(text: string, samples: string[]) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => { const v = samples[Number(n)-1]; return v?.trim() ? v : `{{${n}}}` })
}
function makeButton(type: TemplateButton["type"]): TemplateButton {
  if (type === "QUICK_REPLY")  return { type, text: "" }
  if (type === "URL")          return { type, text: "", url: "" }
  if (type === "PHONE_NUMBER") return { type, text: "", phone_number: "" }
  if (type === "FLOW")         return { type, text: "View flow", flow_id: "", flow_action: "navigate" }
  return { type: "COPY_CODE", text: "Copy offer code", example: "" }
}

const INPUT    = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-800 placeholder-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
const INPUT_SM = "w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-800 placeholder-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"

// â”€â”€â”€ Step progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const STEPS = ["Set up", "Edit", "Review"]
  return (
    <div className="flex items-center gap-0.5">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = step > n; const active = step === n
        return (
          <div key={n} className="flex items-center">
            {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 mx-0.5" />}
            <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              active ? "bg-indigo-50 text-indigo-700" : done ? "text-emerald-600" : "text-slate-400")}>
              <div className={cn("flex h-4.5 w-4.5 h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-bold shrink-0",
                active ? "bg-indigo-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500")}>
                {done ? "âœ“" : n}
              </div>
              <span className="hidden sm:inline">{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// â”€â”€â”€ WhatsApp preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function WAPreview({ headerType, headerContent, bodyText, footerText, buttons, bodySamples, headerSamples }: {
  headerType: string; headerContent: string; bodyText: string; footerText: string
  buttons: TemplateButton[]; bodySamples: string[]; headerSamples: string[]
}) {
  const body   = applyVars(bodyText, bodySamples)
  const header = applyVars(headerContent, headerSamples)
  const has    = headerType || bodyText || footerText || buttons.length > 0
  return (
    <div className="flex justify-center">
      <div className="w-[260px] rounded-[28px] bg-[#1a1a1a] pt-3 pb-5 shadow-2xl">
        <div className="mx-auto mb-2 h-[5px] w-12 rounded-full bg-[#333]" />
        <div className="flex items-center gap-2 bg-[#075E54] px-3 py-2">
          <div className="h-7 w-7 rounded-full bg-emerald-300 flex items-center justify-center text-[10px] font-bold text-white shrink-0">B</div>
          <div><p className="text-[11px] font-semibold text-white">Your Business</p><p className="text-[9px] text-emerald-200">WhatsApp Business</p></div>
        </div>
        <div className="bg-[#ECE5DD] px-2.5 py-3" style={{ minHeight: 380 }}>
          {has ? (
            <div className="max-w-[210px] rounded-xl bg-white shadow-sm overflow-hidden">
              {headerType === "text" && header && <div className="px-2.5 pt-2 pb-1"><p className="text-[11px] font-bold text-[#111] leading-snug">{header}</p></div>}
              {headerType === "image"    && <div className="h-[90px] bg-slate-200 flex items-center justify-center gap-1"><ImageIcon className="h-5 w-5 text-slate-400" /><span className="text-[10px] text-slate-400">Image</span></div>}
              {headerType === "video"    && <div className="h-[90px] bg-slate-700 flex items-center justify-center gap-1"><VideoIcon className="h-5 w-5 text-slate-300" /><span className="text-[10px] text-slate-300">Video</span></div>}
              {headerType === "document" && <div className="flex items-center gap-2 bg-slate-100 px-2.5 py-2"><FileIcon className="h-4 w-4 text-rose-400" /><span className="text-[10px] text-slate-500">Document</span></div>}
              {bodyText && <div className={cn("px-2.5 py-2", !headerType && "pt-2.5")}><p className="text-[10px] text-[#111] whitespace-pre-wrap break-words leading-relaxed">{body}</p></div>}
              {footerText && <div className="px-2.5 pb-1.5"><p className="text-[9px] text-[#999]">{footerText}</p></div>}
              <div className="flex justify-end px-2.5 pb-2"><span className="text-[8px] text-[#999]">10:30 AM âœ“âœ“</span></div>
              {buttons.length > 0 && (
                <div className="border-t border-slate-100">
                  {buttons.map((btn, i) => (
                    <div key={i} className={cn("flex items-center justify-center gap-1.5 py-1.5", i > 0 && "border-t border-slate-100")}>
                      {btn.type === "URL"          && <Link2              className="h-2.5 w-2.5 text-[#00A5F4]" />}
                      {btn.type === "PHONE_NUMBER" && <Phone             className="h-2.5 w-2.5 text-[#00A5F4]" />}
                      {btn.type === "COPY_CODE"   && <Copy              className="h-2.5 w-2.5 text-[#00A5F4]" />}
                      {btn.type === "QUICK_REPLY" && <MessageSquareText className="h-2.5 w-2.5 text-[#00A5F4]" />}
                      {btn.type === "FLOW"        && <Workflow           className="h-2.5 w-2.5 text-[#00A5F4]" />}
                      <span className="text-[10px] font-medium text-[#00A5F4]">{btn.text || "Button"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[320px] text-center">
              <Smartphone className="h-8 w-8 text-slate-300 mb-2" />
              <p className="text-[10px] text-slate-400">Preview appears here</p>
            </div>
          )}
        </div>
        <div className="mx-auto mt-2 h-[4px] w-14 rounded-full bg-[#333]" />
      </div>
    </div>
  )
}

// â”€â”€â”€ Mobile preview overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MobilePreviewOverlay({ onClose, ...previewProps }: Parameters<typeof WAPreview>[0] & { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 shrink-0">
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
        <p className="text-[14px] font-semibold text-slate-900">Message Preview</p>
      </div>
      <div className="flex-1 overflow-y-auto scroll-styled flex items-start justify-center px-4 py-8 bg-slate-50">
        <WAPreview {...previewProps} />
      </div>
    </div>
  )
}

// â”€â”€â”€ Flow button fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FlowButtonFields({ btn, onChange }: {
  btn: Extract<TemplateButton, { type: "FLOW" }>
  onChange: (b: TemplateButton) => void
}) {
  const [flows,   setFlows]   = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch("/api/flows").then(r => r.json())
      .then(d => setFlows(Array.isArray(d) ? d : (d?.flows ?? [])))
      .catch(() => {}).finally(() => setLoading(false))
  }, [])
  const action = btn.flow_action ?? "navigate"
  return (
    <div className="space-y-3 pt-1">
      <div>
        <label className="mb-1 block text-[11px] text-slate-500">WhatsApp Flow</label>
        <select value={btn.flow_id} disabled={loading}
          onChange={e => onChange({ ...btn, flow_id: e.target.value } as TemplateButton)}
          className={INPUT_SM}>
          <option value="">— Select a flow —</option>
          {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {!loading && flows.length === 0 && (
          <p className="mt-1 text-[10px] text-amber-600">No flows found. <a href="/flows" className="underline font-medium">Create flows first â†’</a></p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-slate-500">Flow starts with</label>
        <select value={action}
          onChange={e => {
            const a = e.target.value as "navigate" | "data_exchange"
            onChange({ ...btn, flow_action: a, navigate_screen: a === "data_exchange" ? undefined : btn.navigate_screen } as TemplateButton)
          }}
          className={INPUT_SM}>
          <option value="navigate">Pre-defined screen</option>
          <option value="data_exchange">Network request</option>
        </select>
      </div>
      {action === "navigate" && (
        <div>
          <label className="mb-1 block text-[11px] text-slate-500">Screen ID</label>
          <input value={btn.navigate_screen ?? ""}
            onChange={e => onChange({ ...btn, navigate_screen: e.target.value } as TemplateButton)}
            placeholder="e.g. SCREEN_1" className={INPUT_SM} />
        </div>
      )}
      {action === "data_exchange" && (
        <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] text-violet-600">
          Flow receives customer context via network request when the button is tapped
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Button row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ButtonRow({ btn, onChange, onRemove }: {
  btn: TemplateButton; onChange: (b: TemplateButton) => void; onRemove: () => void
}) {
  const LABEL: Record<string, string> = {
    QUICK_REPLY: "Quick Reply", URL: "Visit Website", PHONE_NUMBER: "Call Phone Number",
    COPY_CODE: "Copy Offer Code", FLOW: "Complete Flow",
  }
  const urlBtn   = btn as Extract<TemplateButton, { type: "URL" }>
  const phoneBtn = btn as Extract<TemplateButton, { type: "PHONE_NUMBER" }>
  const codeBtn  = btn as Extract<TemplateButton, { type: "COPY_CODE" }>
  const flowBtn  = btn as Extract<TemplateButton, { type: "FLOW" }>
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {btn.type === "FLOW"        && <Workflow          className="h-3.5 w-3.5 text-violet-500" />}
          {btn.type === "URL"         && <Link2             className="h-3.5 w-3.5 text-blue-400" />}
          {btn.type === "PHONE_NUMBER"&& <Phone            className="h-3.5 w-3.5 text-green-500" />}
          {btn.type === "QUICK_REPLY" && <MessageSquareText className="h-3.5 w-3.5 text-indigo-400" />}
          {btn.type === "COPY_CODE"  && <Copy             className="h-3.5 w-3.5 text-orange-400" />}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{LABEL[btn.type]}</span>
        </div>
        <button type="button" onClick={onRemove} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-slate-500">Button Text</label>
        <input value={btn.text} onChange={e => onChange({ ...btn, text: e.target.value })}
          placeholder="Label (max 25 chars)" maxLength={25} className={INPUT_SM} />
      </div>
      {btn.type === "URL" && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-500">URL</label>
            <input value={urlBtn.url} onChange={e => onChange({ ...btn, url: e.target.value } as TemplateButton)}
              placeholder="https://example.com  or  https://example.com/{{1}}" className={INPUT_SM} />
          </div>
          {/\{\{1\}\}/.test(urlBtn.url ?? "") && (
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">Example for {"{{1}}"}</label>
              <input value={urlBtn.example ?? ""} onChange={e => onChange({ ...btn, example: e.target.value } as TemplateButton)}
                placeholder="e.g. summer-sale" className={INPUT_SM} />
            </div>
          )}
        </div>
      )}
      {btn.type === "PHONE_NUMBER" && (
        <div>
          <label className="mb-1 block text-[11px] text-slate-500">Phone Number</label>
          <input value={phoneBtn.phone_number} onChange={e => onChange({ ...btn, phone_number: e.target.value } as TemplateButton)}
            placeholder="+91 98765 43210" className={INPUT_SM} />
        </div>
      )}
      {btn.type === "COPY_CODE" && (
        <div>
          <label className="mb-1 block text-[11px] text-slate-500">Sample Promo Code</label>
          <input value={codeBtn.example ?? ""} onChange={e => onChange({ ...btn, example: e.target.value } as TemplateButton)}
            placeholder="e.g. SUMMER25" className={INPUT_SM} />
        </div>
      )}
      {btn.type === "FLOW" && <FlowButtonFields btn={flowBtn} onChange={onChange} />}
    </div>
  )
}

// â”€â”€â”€ Template canvas (3-step wizard, edit-mode aware) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function TemplateCanvas({ onBack, onCreated, editTemplate }: {
  onBack: () => void
  onCreated: () => void
  editTemplate?: MessageTemplate
}) {
  const isEditMode = !!editTemplate

  // Wizard step — skip step 1 when editing an existing template
  const [step, setStep] = useState<1 | 2 | 3>(isEditMode ? 2 : 1)

  // Step 1
  const [category, setCategory] = useState<TCategory>(
    isEditMode ? fromApiCategory(editTemplate?.category) : "MARKETING"
  )
  const [subtype, setSubtype] = useState<TSubtype>(
    isEditMode && editTemplate?.buttons?.some(b => b.type === "FLOW") ? "flows" : "default"
  )

  // Step 2 — pre-populate from editTemplate when in edit mode
  const [name,          setName]          = useState(editTemplate?.name ?? "")
  const [language,      setLanguage]      = useState(editTemplate?.language ?? "en_US")
  const [headerType,    setHeaderType]    = useState(editTemplate?.header_type ?? "")
  const [headerContent, setHeaderContent] = useState(editTemplate?.header_content ?? "")
  const [headerMediaUrl,setHeaderMediaUrl]= useState(editTemplate?.header_media_url ?? "")
  const [bodyText,      setBodyText]      = useState(editTemplate?.body_text ?? "")
  const [footerText,    setFooterText]    = useState(editTemplate?.footer_text ?? "")
  const [buttons,       setButtons]       = useState<TemplateButton[]>(editTemplate?.buttons ?? [])
  const [bodySamples,   setBodySamples]   = useState<string[]>(editTemplate?.sample_values?.body ?? [])
  const [headerSamples, setHeaderSamples] = useState<string[]>(editTemplate?.sample_values?.header ?? [])
  const [showBtnPicker,    setShowBtnPicker]    = useState(false)
  const [showMobilePreview,setShowMobilePreview]= useState(false)
  const [uploading,        setUploading]        = useState(false)
  const [mediaFileName,    setMediaFileName]    = useState(
    editTemplate?.header_media_url ? editTemplate.header_media_url.split("/").pop() ?? "" : ""
  )
  const [showUrlInput,     setShowUrlInput]     = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState("")

  const bodyRef      = useRef<HTMLTextAreaElement>(null)
  const headerRef    = useRef<HTMLInputElement>(null)
  const mediaFileRef = useRef<HTMLInputElement>(null)

  const bodyVars   = extractVars(bodyText)
  const headerVars = headerType === "text" ? extractVars(headerContent) : []

  useEffect(() => { setBodySamples(p => bodyVars.map((_, i) => p[i] ?? "")) }, [bodyVars.length])     // eslint-disable-line
  useEffect(() => { setHeaderSamples(p => headerVars.map((_, i) => p[i] ?? "")) }, [headerVars.length]) // eslint-disable-line

  function goStep2() {
    if (subtype === "flows" && !buttons.some(b => b.type === "FLOW")) {
      setButtons([makeButton("FLOW")])
    }
    setStep(2)
  }

  function insertBodyVar() {
    const ta = bodyRef.current; if (!ta) return
    const next = (bodyVars.length > 0 ? Math.max(...bodyVars) : 0) + 1
    const s = ta.selectionStart ?? ta.value.length; const e = ta.selectionEnd ?? ta.value.length
    const tag = `{{${next}}}`
    setBodyText(ta.value.slice(0, s) + tag + ta.value.slice(e))
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + tag.length, s + tag.length) }, 0)
  }
  function insertHeaderVar() {
    const inp = headerRef.current; if (!inp || /\{\{1\}\}/.test(inp.value)) return
    const s = inp.selectionStart ?? inp.value.length
    setHeaderContent(inp.value.slice(0, s) + "{{1}}" + inp.value.slice(s))
  }

  async function uploadMedia(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res  = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Upload failed"); return }
      setHeaderMediaUrl(data.url)
      setMediaFileName(file.name)
      setShowUrlInput(false)
    } catch { toast.error("Upload failed") }
    finally { setUploading(false) }
  }

  function clearMedia() {
    setHeaderMediaUrl("")
    setMediaFileName("")
    setShowUrlInput(false)
    if (mediaFileRef.current) mediaFileRef.current.value = ""
  }

  async function submit() {
    setSubmitting(true); setError("")
    try {
      const payload = {
        name,
        category: toApiCategory(category),
        language,
        header_type: headerType || undefined,
        header_content: headerType === "text" ? headerContent : undefined,
        header_media_url: (headerType === "image" || headerType === "video" || headerType === "document") ? headerMediaUrl : undefined,
        body_text: bodyText,
        footer_text: footerText || undefined,
        buttons: buttons.length ? buttons : undefined,
        sample_values: { body: bodySamples, header: headerSamples },
      }

      let res: Response
      if (isEditMode && editTemplate?.id) {
        res = await fetch(`/api/whatsapp/templates/${editTemplate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch("/api/whatsapp/templates/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      }

      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Submission failed"); return }
      toast.success(isEditMode ? "Template resubmitted to Meta!" : "Template submitted to Meta for approval!")
      onCreated(); onBack()
    } catch { setError("Network error") }
    finally { setSubmitting(false) }
  }

  const previewProps = {
    headerType, headerContent, bodyText, footerText,
    buttons, bodySamples, headerSamples,
  }

  const canGoStep2 = isEditMode || (category !== "AUTHENTICATION" && SUBTYPES[category].find(s => s.id === subtype)?.supported)

  const isFlowsType = subtype === "flows"

  // â”€â”€ Top bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const topBar = (
    <div className="shrink-0 flex items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-6 py-3 gap-2 sm:gap-4">
      <button type="button" onClick={onBack}
        className="flex items-center gap-1.5 shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Templates</span>
      </button>

      <StepBar step={step} />

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Mobile preview toggle */}
        {step === 2 && (
          <button type="button" onClick={() => setShowMobilePreview(true)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 lg:hidden">
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" onClick={onBack}
          className="hidden sm:inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          Discard
        </button>
        {step === 1 && (
          <button type="button" onClick={goStep2} disabled={!canGoStep2}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        {step === 2 && (
          <>
            <button type="button" onClick={() => isEditMode ? onBack() : setStep(1)}
              className="hidden sm:inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">Back</button>
            <button type="button" onClick={() => setStep(3)} disabled={!name.trim() || !bodyText.trim()}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              Review <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button type="button" onClick={() => setStep(2)}
              className="hidden sm:inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">Back</button>
            <button type="button" onClick={submit} disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {submitting && <RefreshCw className="h-3 w-3 animate-spin" />}
              <span className="hidden sm:inline">{isEditMode ? "Resubmit" : "Submit to Meta"}</span>
              <span className="sm:hidden">Submit</span>
            </button>
          </>
        )}
      </div>
    </div>
  )

  // â”€â”€ STEP 1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (step === 1) {
    const selectedSubtype = SUBTYPES[category].find(s => s.id === subtype)
    return (
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">
        {topBar}
        <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
          {/* Left form */}
          <div className="flex-1 overflow-y-auto scroll-styled px-4 sm:px-8 py-6">
            <div className="mx-auto max-w-[600px]">
              <h2 className="text-[16px] sm:text-[18px] font-semibold text-slate-900 mb-1">Set up your template</h2>
              <p className="text-[12px] sm:text-[13px] text-slate-500 mb-5">Choose the category and type that best describe your message.</p>

              {/* Category tabs */}
              <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 mb-5">
                {(["MARKETING", "UTILITY", "AUTHENTICATION"] as TCategory[]).map(c => (
                  <button key={c} type="button" onClick={() => { setCategory(c); setSubtype(SUBTYPES[c][0].id) }}
                    className={cn("flex-1 rounded-lg py-2 text-[11px] sm:text-[12px] font-semibold transition-colors",
                      category === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                    <span className="hidden sm:inline">{c === "MARKETING" ? "📢 Marketing" : c === "UTILITY" ? "🔔 Utility" : "🔑 Authentication"}</span>
                    <span className="sm:hidden">{c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utility" : "Auth"}</span>
                  </button>
                ))}
              </div>

              {category === "AUTHENTICATION" ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-[13px] font-semibold text-amber-800 mb-1">Authentication templates not supported here</p>
                  <p className="text-[12px] text-amber-700">Create OTP templates in Meta Business Manager, then use &quot;Sync from Meta&quot; to import them.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {SUBTYPES[category].map(opt => (
                    <button key={opt.id} type="button"
                      onClick={() => opt.supported && setSubtype(opt.id)}
                      disabled={!opt.supported}
                      className={cn(
                        "w-full flex items-start gap-3 rounded-xl border-2 p-3.5 sm:p-4 text-left transition-all",
                        subtype === opt.id && opt.supported
                          ? "border-indigo-500 bg-indigo-50"
                          : opt.supported
                            ? "border-slate-200 bg-white hover:border-slate-300"
                            : "border-slate-100 bg-slate-50 cursor-not-allowed opacity-60"
                      )}>
                      <div className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                        subtype === opt.id && opt.supported ? "border-indigo-500 bg-indigo-500" : "border-slate-300")}>
                        {subtype === opt.id && opt.supported && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={cn("text-[12px] sm:text-[13px] font-semibold", subtype === opt.id && opt.supported ? "text-indigo-800" : "text-slate-800")}>{opt.label}</p>
                          {!opt.supported && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] sm:text-[10px] text-slate-500">Coming soon</span>}
                        </div>
                        <p className="mt-0.5 text-[11px] sm:text-[12px] text-slate-500 leading-snug">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right static preview — desktop only */}
          <div className="hidden lg:flex flex-col w-[320px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto scroll-styled px-6 py-6">
            <p className="mb-1 text-[12px] font-semibold text-slate-700">Template preview</p>
            <p className="mb-5 text-[11px] text-slate-400 capitalize">{selectedSubtype?.label ?? subtype} example</p>
            <WAPreview
              headerType="" headerContent=""
              bodyText={subtype === "flows"
                ? "Hi {{1}}, we'd love to hear your feedback! Tap below to fill out a quick form."
                : "Hi {{1}}, your order {{2}} has been confirmed!\nExpected delivery: {{3}}."}
              footerText={subtype === "default" ? "Reply STOP to opt out" : ""}
              buttons={subtype === "flows"
                ? [{ type: "FLOW", text: "Share Feedback", flow_id: "", flow_action: "navigate" }]
                : [{ type: "URL", text: "Track Order", url: "https://example.com" }]}
              bodySamples={["John", "ORD-1234", "Dec 25"]}
              headerSamples={[]}
            />
          </div>
        </div>
      </div>
    )
  }

  // â”€â”€ STEP 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (step === 2) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-slate-50">
        {topBar}
        {showMobilePreview && <MobilePreviewOverlay {...previewProps} onClose={() => setShowMobilePreview(false)} />}

        <div className="flex flex-1 overflow-hidden">
          {/* Form */}
          <div className="flex-1 overflow-y-auto scroll-styled px-4 sm:px-8 py-6">
            <div className="mx-auto max-w-[660px] space-y-6">

              {/* Name + Language */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Template Name</label>
                  <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="e.g. order_confirmation"
                    disabled={isEditMode}
                    className={cn(INPUT, isEditMode && "bg-slate-50 text-slate-500 cursor-not-allowed")} />
                  {isEditMode
                    ? <p className="mt-1 text-[11px] text-slate-400">Name cannot be changed after submission</p>
                    : <p className="mt-1 text-[11px] text-slate-400">Lowercase, digits, underscores only</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Language</label>
                  <select value={language} onChange={e => setLanguage(e.target.value)} className={INPUT}>
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-200" />

              {/* Header */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-semibold text-slate-700">Header</label>
                  <span className="text-[11px] text-slate-400">Optional</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {HEADER_TYPES.map(opt => (
                    <button key={opt.v} type="button"
                      onClick={() => { setHeaderType(opt.v); setHeaderContent(""); setHeaderMediaUrl(""); setMediaFileName(""); setShowUrlInput(false) }}
                      className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-2 text-[11px] sm:text-[12px] font-medium transition-colors",
                        headerType === opt.v ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                      {opt.icon}{opt.label}
                    </button>
                  ))}
                </div>
                {headerType === "text" && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="relative">
                      <input ref={headerRef} value={headerContent} onChange={e => setHeaderContent(e.target.value)}
                        placeholder="Header text (max 60 chars)" maxLength={60} className={INPUT} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{headerContent.length}/60</span>
                    </div>
                    {!extractVars(headerContent).length && (
                      <button type="button" onClick={insertHeaderVar} className="text-[12px] text-indigo-600 hover:underline">+ Add variable {"{{1}}"}</button>
                    )}
                    {headerVars.length > 0 && (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                        <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Sample for {"{{1}}"}</label>
                        <input value={headerSamples[0] ?? ""} onChange={e => setHeaderSamples([e.target.value])}
                          placeholder="Example text for Meta reviewers" className={INPUT_SM} />
                      </div>
                    )}
                  </div>
                )}
                {(headerType === "image" || headerType === "video" || headerType === "document") && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    {/* Hidden file input */}
                    <input
                      ref={mediaFileRef}
                      type="file"
                      className="hidden"
                      accept={
                        headerType === "image"    ? "image/png,image/jpeg,image/webp,image/gif" :
                        headerType === "video"    ? "video/mp4,video/3gpp" :
                        ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      }
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadMedia(f) }}
                    />

                    {/* Uploaded / selected file state */}
                    {mediaFileName && headerMediaUrl ? (
                      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-emerald-800 truncate">{mediaFileName}</p>
                          <p className="text-[10px] text-emerald-600 truncate">{headerMediaUrl}</p>
                        </div>
                        <button type="button" onClick={clearMedia}
                          className="shrink-0 rounded-md p-1 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      /* Drop zone */
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => mediaFileRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadMedia(f) }}
                        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-indigo-400 hover:bg-indigo-50/40 disabled:opacity-60 transition-colors cursor-pointer">
                        {uploading ? (
                          <>
                            <RefreshCw className="h-7 w-7 text-indigo-400 animate-spin" />
                            <p className="text-[12px] font-medium text-indigo-600">Uploading…</p>
                          </>
                        ) : (
                          <>
                            {headerType === "image"    && <ImageIcon    className="h-8 w-8 text-slate-400" />}
                            {headerType === "video"    && <VideoIcon    className="h-8 w-8 text-slate-400" />}
                            {headerType === "document" && <FileIcon     className="h-8 w-8 text-slate-400" />}
                            <div>
                              <p className="text-[13px] font-semibold text-slate-700">
                                {headerType === "image"    ? "Upload image"    :
                                 headerType === "video"    ? "Upload video"    : "Upload document"}
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {headerType === "image"    ? "PNG, JPG, WEBP, GIF Â· max 16 MB" :
                                 headerType === "video"    ? "MP4, 3GP Â· max 16 MB" :
                                 "PDF, DOCX, XLSX, PPTX, TXT Â· max 16 MB"}
                              </p>
                              <p className="text-[11px] text-indigo-600 mt-1.5 font-medium">Click to browse or drag & drop</p>
                            </div>
                          </>
                        )}
                      </button>
                    )}

                    {/* URL input toggle */}
                    {!showUrlInput && !mediaFileName && (
                      <button type="button" onClick={() => setShowUrlInput(true)}
                        className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-indigo-600 transition-colors">
                        <Link2 className="h-3.5 w-3.5" /> Use a URL instead
                      </button>
                    )}
                    {showUrlInput && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-medium text-slate-600">Media URL</label>
                          <button type="button" onClick={() => setShowUrlInput(false)} className="text-[11px] text-slate-400 hover:text-slate-600">Hide</button>
                        </div>
                        <input value={headerMediaUrl} onChange={e => { setHeaderMediaUrl(e.target.value); setMediaFileName("") }}
                          placeholder={`https://example.com/sample.${headerType === "image" ? "jpg" : headerType === "video" ? "mp4" : "pdf"}`}
                          className={INPUT} />
                      </div>
                    )}

                    <p className="text-[10px] text-slate-400">Used as sample for Meta review. Actual media is provided at send time.</p>
                  </div>
                )}
              </div>

              {/* Body */}
              <div>
                <label className="mb-2 block text-[12px] font-semibold text-slate-700">Body</label>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="relative">
                    <textarea ref={bodyRef} value={bodyText} onChange={e => setBodyText(e.target.value)}
                      placeholder={"Hi {{1}}, your order {{2}} has been confirmed!\nExpected delivery: {{3}}."}
                      rows={5} maxLength={1024} className={cn(INPUT, "resize-none leading-relaxed")} />
                    <span className="absolute bottom-3 right-3 text-[11px] text-slate-400">{bodyText.length}/1024</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={insertBodyVar}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                      + Add variable
                    </button>
                    <p className="text-[11px] text-slate-400">{"{{1}}"}, {"{{2}}"} … must be sequential</p>
                  </div>
                  {bodyVars.length > 0 && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2.5">
                      <p className="text-[12px] font-semibold text-slate-600">Sample values <span className="font-normal text-slate-400">— required for Meta</span></p>
                      {bodyVars.map((n, i) => (
                        <div key={n} className="flex items-center gap-2 sm:gap-3">
                          <span className="shrink-0 w-10 sm:w-12 text-center rounded-md bg-white border border-slate-200 text-[10px] sm:text-[11px] font-mono text-slate-600 py-1">{`{{${n}}}`}</span>
                          <input value={bodySamples[i] ?? ""}
                            onChange={e => setBodySamples(p => { const x = [...p]; x[i] = e.target.value; return x })}
                            placeholder={`Sample for {{${n}}}`} className={INPUT_SM} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-semibold text-slate-700">Footer</label>
                  <span className="text-[11px] text-slate-400">Optional</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="relative">
                    <input value={footerText} onChange={e => setFooterText(e.target.value)}
                      placeholder="e.g. Reply STOP to unsubscribe" maxLength={60} className={INPUT} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{footerText.length}/60</span>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[12px] font-semibold text-slate-700">Buttons</label>
                  <span className="text-[11px] text-slate-400">Optional Â· max 10</span>
                </div>
                {isFlowsType && (
                  <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-700">
                    Flows template — the Complete Flow button is required
                  </div>
                )}
                <div className="space-y-2">
                  {buttons.map((btn, i) => (
                    <ButtonRow key={i} btn={btn}
                      onChange={b => setButtons(p => p.map((x, j) => j === i ? b : x))}
                      onRemove={() => { if (isFlowsType && btn.type === "FLOW") return; setButtons(p => p.filter((_, j) => j !== i)) }} />
                  ))}
                  {buttons.length < 10 && !isFlowsType && (
                    <div className="relative">
                      <button type="button" onClick={() => setShowBtnPicker(v => !v)}
                        className="flex items-center gap-2 w-full rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-[13px] text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                        <Plus className="h-4 w-4" /> Add a button
                      </button>
                      {showBtnPicker && (
                        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                          {BUTTON_OPTS.map(opt => (
                            <button key={opt.type} type="button"
                              onClick={() => { setButtons(p => [...p, makeButton(opt.type)]); setShowBtnPicker(false) }}
                              className="flex w-full items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                              <div className="pt-0.5 shrink-0">
                                {opt.type === "QUICK_REPLY"  && <MessageSquareText className="h-4 w-4 text-slate-400" />}
                                {opt.type === "URL"          && <Link2             className="h-4 w-4 text-slate-400" />}
                                {opt.type === "PHONE_NUMBER" && <Phone            className="h-4 w-4 text-slate-400" />}
                                {opt.type === "COPY_CODE"   && <Copy             className="h-4 w-4 text-slate-400" />}
                                {opt.type === "FLOW"        && <Workflow          className="h-4 w-4 text-violet-400" />}
                              </div>
                              <div>
                                <p className="text-[12px] font-medium text-slate-700">{opt.label}</p>
                                <p className="text-[10px] text-slate-400">{opt.desc}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile back button */}
              <div className="flex sm:hidden gap-2">
                <button type="button" onClick={() => isEditMode ? onBack() : setStep(1)}
                  className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600">Back</button>
                <button type="button" onClick={() => setStep(3)} disabled={!name.trim() || !bodyText.trim()}
                  className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">Review â†’</button>
              </div>

              <div className="h-2" />
            </div>
          </div>

          {/* Live preview — desktop only */}
          <div className="hidden lg:flex flex-col w-[320px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto scroll-styled px-6 py-6">
            <p className="mb-1 text-[12px] font-semibold text-slate-700">Live Preview</p>
            <p className="mb-5 text-[11px] text-slate-400">Updates as you type</p>
            <WAPreview {...previewProps} />
          </div>
        </div>
      </div>
    )
  }

  // â”€â”€ STEP 3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {topBar}
      {showMobilePreview && <MobilePreviewOverlay {...previewProps} onClose={() => setShowMobilePreview(false)} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Summary */}
        <div className="flex-1 overflow-y-auto scroll-styled px-4 sm:px-8 py-6">
          <div className="mx-auto max-w-[600px]">
            <h2 className="text-[16px] sm:text-[18px] font-semibold text-slate-900 mb-1">
              {isEditMode ? "Resubmit for Review" : "Submit for Review"}
            </h2>
            <p className="text-[12px] sm:text-[13px] text-slate-500 mb-5">
              {isEditMode
                ? "Review changes before resubmitting. Meta will re-review and status will return to PENDING."
                : "Review your template before submitting. Meta usually approves within a few minutes."}
            </p>
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{error}
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 flex-wrap border-b border-slate-100 px-4 sm:px-5 py-3.5">
                <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] sm:text-[11px] font-semibold", CATEGORY_COLOR[category])}>
                  {category}
                </span>
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] sm:text-[11px] font-semibold text-slate-600 capitalize">{subtype.replace(/_/g, " ")}</span>
                <span className="ml-auto text-[11px] sm:text-[12px] text-slate-500">{LANGUAGES.find(l => l.code === language)?.label ?? language}</span>
              </div>
              <div className="px-4 sm:px-5 py-4 space-y-4">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">Template name</p>
                  <p className="text-[13px] font-semibold text-slate-900 font-mono">{name || "—"}</p>
                </div>
                {headerType && (
                  <div>
                    <p className="text-[11px] text-slate-400 mb-0.5">Header</p>
                    <p className="text-[13px] text-slate-700 capitalize">{headerType}{headerType === "text" ? `: ${headerContent}` : ""}</p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">Body</p>
                  <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{bodyText || "—"}</p>
                </div>
                {footerText && (
                  <div>
                    <p className="text-[11px] text-slate-400 mb-0.5">Footer</p>
                    <p className="text-[13px] text-slate-500">{footerText}</p>
                  </div>
                )}
                {buttons.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1.5">Buttons</p>
                    <div className="space-y-1.5">
                      {buttons.map((btn, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                          {btn.type === "FLOW"        && <Workflow          className="h-3.5 w-3.5 text-violet-500" />}
                          {btn.type === "URL"         && <Link2             className="h-3.5 w-3.5 text-blue-500" />}
                          {btn.type === "PHONE_NUMBER"&& <Phone            className="h-3.5 w-3.5 text-green-500" />}
                          {btn.type === "QUICK_REPLY" && <MessageSquareText className="h-3.5 w-3.5 text-indigo-500" />}
                          {btn.type === "COPY_CODE"  && <Copy             className="h-3.5 w-3.5 text-orange-500" />}
                          <span className="text-[12px] font-medium text-slate-700">{btn.text}</span>
                          <span className="ml-auto text-[10px] text-slate-400">{btn.type.replace(/_/g, " ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 bg-emerald-50 px-4 sm:px-5 py-3 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-[11px] sm:text-[12px] text-emerald-700 font-medium">
                  {isEditMode ? "Ready to resubmit — Meta will re-review your changes" : "Ready to submit — Meta usually approves within minutes"}
                </p>
              </div>
            </div>

            {/* Mobile action buttons */}
            <div className="flex sm:hidden gap-2 mt-4">
              <button type="button" onClick={() => setStep(2)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600">Back</button>
              <button type="button" onClick={submit} disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {isEditMode ? "Resubmit" : "Submit to Meta"}
              </button>
            </div>
          </div>
        </div>

        {/* Final preview — desktop only */}
        <div className="hidden lg:flex flex-col w-[320px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto scroll-styled px-6 py-6">
          <p className="mb-1 text-[12px] font-semibold text-slate-700">Final Preview</p>
          <p className="mb-5 text-[11px] text-slate-400">How it will appear to recipients</p>
          <WAPreview {...previewProps} />
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ Template list page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function TemplatesV2() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading,  setLoading]    = useState(true)
  const [syncing,  setSyncing]    = useState(false)
  const [creating, setCreating]   = useState(false)
  const [editing,  setEditing]    = useState<MessageTemplate | null>(null)
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [deleting, setDeleting]   = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await fetch("/api/whatsapp/templates").then(r => r.json())
      setTemplates(Array.isArray(data) ? data : (data?.templates ?? []))
    } catch { toast.error("Failed to load templates") }
    finally { setLoading(false) }
  }

  async function sync() {
    setSyncing(true)
    try {
      const res  = await fetch("/api/whatsapp/templates/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Sync failed"); return }
      toast.success(`Synced — ${data.inserted ?? 0} new, ${data.updated ?? 0} updated`)
      load()
    } catch { toast.error("Failed to sync") }
    finally { setSyncing(false) }
  }

  async function deleteTemplate() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res  = await fetch(`/api/whatsapp/templates/${deleteId}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Delete failed"); return }
      toast.success("Template deleted")
      setDeleteId(null)
      load()
    } catch { toast.error("Failed to delete") }
    finally { setDeleting(false) }
  }

  useEffect(() => { load() }, [])

  if (creating || editing) {
    return (
      <TemplateCanvas
        onBack={() => { setCreating(false); setEditing(null) }}
        onCreated={load}
        editTemplate={editing ?? undefined}
      />
    )
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 sm:px-6 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50">
              <FileText className="h-4 w-4 text-amber-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] sm:text-[15px] font-semibold text-slate-900">Templates</h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">{templates.length} template{templates.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button type="button" onClick={sync} disabled={syncing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 sm:px-3 py-1.5 text-[12px] sm:text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
              <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", syncing && "animate-spin")} />
              <span className="hidden sm:inline">Sync from Meta</span>
            </button>
            <button type="button" onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 sm:px-3 py-1.5 text-[12px] sm:text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">New Template</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="p-3 sm:p-6 grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          [...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-[150px] animate-pulse" />)
        ) : templates.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
              <FileText className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">No templates yet</p>
            <p className="mt-1 text-[12px] text-slate-400">Create a new template or sync existing ones from Meta</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
                <Plus className="h-3.5 w-3.5" /> New Template
              </button>
              <button type="button" onClick={sync}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" /> Sync from Meta
              </button>
            </div>
          </div>
        ) : templates.map(t => {
          const canEdit = EDITABLE_STATUSES.has(t.status ?? "DRAFT")
          const statusKey = t.status ?? "DRAFT"
          return (
            <div key={t.id} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden hover:shadow-md transition-shadow">
              {/* Card top */}
              <div className="flex items-start gap-3 px-4 pt-4 pb-3">
                {/* Category icon */}
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px]",
                  t.category === "Marketing" ? "bg-amber-50" : t.category === "Utility" ? "bg-blue-50" : "bg-purple-50")}>
                  {t.category === "Marketing" ? "📢" : t.category === "Utility" ? "🔔" : "🔑"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-900 break-all leading-tight">{t.name}</p>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap", STATUS_COLOR[statusKey] ?? STATUS_COLOR.DRAFT)}>
                      {statusKey}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-slate-400">{t.category}</span>
                    {t.language && <span className="text-[10px] text-slate-400">Â· {t.language}</span>}
                    {t.quality_score && (
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                        t.quality_score === "GREEN" ? "bg-emerald-50 text-emerald-600" :
                        t.quality_score === "YELLOW" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600")}>
                        {t.quality_score}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Body preview */}
              <div className="px-4 pb-3 flex-1">
                <p className="text-[12px] text-slate-600 line-clamp-3 leading-relaxed">{t.body_text}</p>
                {t.buttons && t.buttons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.buttons.slice(0, 3).map((btn, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                        {btn.type === "FLOW"        && <Workflow          className="h-2.5 w-2.5 text-violet-400" />}
                        {btn.type === "URL"         && <Link2             className="h-2.5 w-2.5 text-blue-400" />}
                        {btn.type === "PHONE_NUMBER"&& <Phone            className="h-2.5 w-2.5 text-green-400" />}
                        {btn.type === "QUICK_REPLY" && <MessageSquareText className="h-2.5 w-2.5 text-indigo-400" />}
                        {btn.type === "COPY_CODE"  && <Copy             className="h-2.5 w-2.5 text-orange-400" />}
                        {btn.text || btn.type}
                      </span>
                    ))}
                    {t.buttons.length > 3 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">+{t.buttons.length - 3} more</span>}
                  </div>
                )}
                {t.rejection_reason && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 mt-2 text-[11px] text-rose-700">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{t.rejection_reason}</span>
                  </div>
                )}
              </div>

              {/* Action footer */}
              <div className="flex items-center border-t border-slate-100 px-3 py-2 gap-1">
                <button
                  type="button"
                  onClick={() => canEdit ? setEditing(t) : toast.info(`Templates in ${statusKey} status cannot be edited`)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium transition-colors",
                    canEdit
                      ? "text-indigo-600 hover:bg-indigo-50"
                      : "text-slate-400 cursor-default"
                  )}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <div className="w-px h-5 bg-slate-200" />
                <button
                  type="button"
                  onClick={() => setDeleteId(t.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Delete confirmation modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteId(null)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 mb-4">
              <Trash2 className="h-5 w-5 text-rose-500" />
            </div>
            <h2 className="text-[16px] font-semibold text-slate-900 mb-1">Delete template?</h2>
            <p className="text-[13px] text-slate-500 mb-5">This will remove the template from Meta and cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)} disabled={deleting}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={deleteTemplate} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 py-2.5 text-[13px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                {deleting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
