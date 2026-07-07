"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Zap, BarChart3, PhoneOff, Phone, Plus, X, GripVertical, XCircle, Smile, Globe } from "lucide-react"

export type ListItem = { icon: string; label: string }

const EMOJI_GRID = [
  // Priority / scores
  "🔥","⭐","💎","🎯","🏆","🥇","🥈","🥉","👑","💯","🌟","✨",
  // Positive / negative
  "👍","👎","✅","❌","⚠️","🚫","💚","❤️","🖤","🤍",
  // Time / status
  "⏰","🔄","📅","📌","🆕","🔔","⏳","🕐","📍","🔁",
  // Communication
  "💬","📞","📱","📧","🗣️","📢","🤝","💌","📨","📩",
  // Business / money
  "💰","💳","🏢","🏦","📊","📈","📉","💼","🤑","🎰",
  // People
  "👤","👥","🧑‍💼","👨‍💻","🙋","🙅","🙆","🤔","😊","😐",
  // Objects / tools
  "📋","📝","📁","🗂️","🔍","🔎","🗃️","🖊️","🗒️","📎",
  // Misc / CRM
  "🎉","🚀","💡","🏷️","🔑","🎁","🌐","⭕","🔵","🟢",
]

function isImgUrl(s: string) {
  return s.startsWith("data:") || s.startsWith("http") || s.startsWith("/")
}

function IconPreview({ value, size = "h-5 w-5" }: { value: string; size?: string }) {
  if (!value) return <Smile className="h-4 w-4 text-slate-400" />
  if (isImgUrl(value)) return <img src={value} alt="" className={`${size} object-contain rounded`} />
  return <span className="text-[16px] leading-none">{value}</span>
}

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"emoji" | "image">("emoji")
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result as string
      if (result) { onChange(result); setOpen(false) }
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Pick icon"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors overflow-hidden"
      >
        <IconPreview value={value} />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-[200] rounded-xl border border-slate-200 bg-white shadow-2xl w-[240px]">
          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            <button
              type="button"
              onClick={() => setTab("emoji")}
              className={`flex-1 py-1.5 text-[11px] font-semibold rounded-tl-xl transition-colors ${tab === "emoji" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              Emoji
            </button>
            <button
              type="button"
              onClick={() => setTab("image")}
              className={`flex-1 py-1.5 text-[11px] font-semibold rounded-tr-xl transition-colors ${tab === "image" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              Image
            </button>
          </div>

          {tab === "emoji" ? (
            <div className="p-2">
              <div className="grid grid-cols-10 gap-0.5">
                {EMOJI_GRID.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    className="flex h-6 w-6 items-center justify-center rounded text-[15px] hover:bg-indigo-50 transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 flex flex-col items-center gap-3">
              {value && isImgUrl(value) && (
                <img src={value} alt="Current icon" className="h-12 w-12 object-contain rounded-lg border border-slate-100" />
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-lg border-2 border-dashed border-indigo-200 py-3 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                Browse PNG / SVG
              </button>
              <p className="text-[10px] text-slate-400 text-center">PNG, SVG, JPEG accepted. Shown at 16×16px.</p>
              <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
            </div>
          )}

          {value && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false) }}
                className="w-full rounded-lg py-1 text-[11px] text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              >
                Clear icon
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EditableItemList({
  label,
  sectionIcon,
  accent,
  items,
  addLabel,
  onChange,
}: {
  label: string
  sectionIcon: React.ReactNode
  accent: "rose" | "emerald" | "indigo"
  items: ListItem[]
  addLabel: string
  onChange: (items: ListItem[]) => void
}) {
  const colors = {
    rose: {
      header: "text-rose-700", headerBg: "bg-rose-50 border-rose-100",
      badge: "bg-rose-100 text-rose-700",
      input: "border-rose-200 focus:border-rose-400 focus:ring-rose-100",
      add: "text-rose-600 hover:text-rose-800 hover:bg-rose-50",
      remove: "text-rose-300 hover:text-rose-600 hover:bg-rose-100",
    },
    emerald: {
      header: "text-emerald-700", headerBg: "bg-emerald-50 border-emerald-100",
      badge: "bg-emerald-100 text-emerald-700",
      input: "border-emerald-200 focus:border-emerald-400 focus:ring-emerald-100",
      add: "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50",
      remove: "text-emerald-300 hover:text-emerald-600 hover:bg-emerald-100",
    },
    indigo: {
      header: "text-indigo-700", headerBg: "bg-indigo-50 border-indigo-100",
      badge: "bg-indigo-100 text-indigo-700",
      input: "border-indigo-200 focus:border-indigo-400 focus:ring-indigo-100",
      add: "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50",
      remove: "text-indigo-300 hover:text-indigo-600 hover:bg-indigo-100",
    },
  }[accent]

  function updateIcon(idx: number, icon: string) {
    const next = items.map((it, i) => i === idx ? { ...it, icon } : it)
    onChange(next)
  }

  function updateLabel(idx: number, lbl: string) {
    const next = items.map((it, i) => i === idx ? { ...it, label: lbl } : it)
    onChange(next)
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  return (
    <div className="rounded-xl border border-slate-100">
      <div className={`flex items-center gap-2 px-4 py-3 border-b rounded-t-xl ${colors.headerBg}`}>
        <span className={colors.header}>{sectionIcon}</span>
        <span className={`text-[13px] font-semibold ${colors.header}`}>{label}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${colors.badge}`}>
          {items.length}
        </span>
      </div>
      <div className="bg-white p-3 space-y-2 rounded-b-xl">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <GripVertical className="h-3.5 w-3.5 text-slate-300 shrink-0" />
            <EmojiPicker value={item.icon} onChange={(e) => updateIcon(i, e)} />
            <input
              value={item.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              placeholder="Label…"
              className={`flex-1 rounded-lg border px-3 py-1.5 text-[13px] text-slate-800 outline-none focus:ring-2 transition-colors ${colors.input}`}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className={`h-6 w-6 flex items-center justify-center rounded-md transition-colors ${colors.remove}`}
              title="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, { icon: "", label: "" }])}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors w-full ${colors.add}`}
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      </div>
    </div>
  )
}

// Normalise raw JSON (old string[] or new {icon,label}[]) to ListItem[]
function normalise(raw: unknown, defaults: ListItem[]): ListItem[] {
  if (!Array.isArray(raw)) return defaults
  return raw.map((v) => {
    if (typeof v === "string") return { icon: "", label: v }
    if (v && typeof v === "object" && "label" in v) {
      return { icon: (v as { icon?: string }).icon ?? "", label: String((v as { label: unknown }).label) }
    }
    return { icon: "", label: String(v) }
  })
}

const DEF_SCORE_OPTIONS: ListItem[]  = [
  { icon: "🔥", label: "Hot" },
  { icon: "🌡️", label: "Warm" },
  { icon: "❄️", label: "Cold" },
]
const DEF_NOT_CONNECTED: ListItem[] = [
  { icon: "📵", label: "Out of Coverage" },
  { icon: "📳", label: "Busy" },
  { icon: "🔇", label: "Switched Off" },
  { icon: "❌", label: "Invalid Number" },
]
const DEF_CONNECTED: ListItem[] = [
  { icon: "🏢", label: "Visited" },
  { icon: "📅", label: "Appointment Fixed" },
  { icon: "🔄", label: "Follow-up" },
]
const DEF_CLOSE_REASONS: ListItem[] = [
  { icon: "🎉", label: "Converted / Enrolled" },
  { icon: "👎", label: "Not Interested" },
  { icon: "💰", label: "Budget Issue" },
  { icon: "❓", label: "Wrong Enquiry" },
  { icon: "📋", label: "Duplicate" },
  { icon: "📝", label: "Other" },
]
const DEF_LEAD_SOURCES: ListItem[] = [
  { icon: "", label: "WhatsApp" },
  { icon: "", label: "Instagram" },
  { icon: "🌐", label: "Website" },
  { icon: "📣", label: "Campaign" },
  { icon: "🔗", label: "Referral" },
  { icon: "👤", label: "Manual" },
  { icon: "📝", label: "Other" },
]

interface SettingsData {
  auto_lead_creation: boolean
  scoring_mode: string
  score_options: ListItem[]
  call_not_connected_labels: ListItem[]
  call_connected_labels: ListItem[]
  close_enquiry_reasons: ListItem[]
  lead_sources: ListItem[]
}

export function LeadsSettingsV2() {
  const [settings, setSettings] = useState<SettingsData>({
    auto_lead_creation: false,
    scoring_mode: "score",
    score_options: DEF_SCORE_OPTIONS,
    call_not_connected_labels: DEF_NOT_CONNECTED,
    call_connected_labels: DEF_CONNECTED,
    close_enquiry_reasons: DEF_CLOSE_REASONS,
    lead_sources: DEF_LEAD_SOURCES,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/leads/settings")
      .then((r) => r.json())
      .then((d) =>
        setSettings({
          auto_lead_creation: d.auto_lead_creation ?? false,
          scoring_mode: d.scoring_mode ?? "score",
          score_options: normalise(d.score_options, DEF_SCORE_OPTIONS),
          call_not_connected_labels: normalise(d.call_not_connected_labels, DEF_NOT_CONNECTED),
          call_connected_labels: normalise(d.call_connected_labels, DEF_CONNECTED),
          close_enquiry_reasons: normalise(d.close_enquiry_reasons, DEF_CLOSE_REASONS),
          lead_sources: normalise(d.lead_sources, DEF_LEAD_SOURCES),
        })
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/leads/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Lead settings saved")
    } catch {
      toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-36 rounded-lg bg-slate-100" />
        <div className="h-20 rounded-xl bg-slate-100" />
        <div className="h-20 rounded-xl bg-slate-100" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[18px] font-bold text-slate-900">Lead Settings</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Configure how leads are created, scored, and what call outcomes agents can record.
        </p>
      </div>

      {/* Auto Lead Creation */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Zap className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-slate-900">Auto Lead Creation</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Automatically create a lead when a new customer sends their first WhatsApp message.
              It will appear in the New Leads pool for agents to claim.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.auto_lead_creation}
            onClick={() => setSettings((s) => ({ ...s, auto_lead_creation: !s.auto_lead_creation }))}
            className={`relative shrink-0 mt-0.5 h-6 w-10 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 ${
              settings.auto_lead_creation ? "bg-indigo-600" : "bg-slate-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                settings.auto_lead_creation ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Lead Score Options */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-slate-900">Lead Score Options</p>
            <p className="text-[12px] text-slate-500">
              Define score levels agents assign to leads. Pick an icon and write a label for each.
            </p>
          </div>
        </div>
        <EditableItemList
          label="Score Levels"
          sectionIcon={<BarChart3 className="h-4 w-4" />}
          accent="indigo"
          items={settings.score_options}
          addLabel="Add score level"
          onChange={(items) => setSettings((s) => ({ ...s, score_options: items }))}
        />
      </div>

      {/* Call Outcomes */}
      <div className="space-y-3">
        <div>
          <p className="text-[14px] font-semibold text-slate-900">Call Outcomes</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Customize the outcome labels agents see when logging call results.
          </p>
        </div>
        <EditableItemList
          label="Call Not Connected"
          sectionIcon={<PhoneOff className="h-4 w-4" />}
          accent="rose"
          items={settings.call_not_connected_labels}
          addLabel="Add outcome"
          onChange={(items) => setSettings((s) => ({ ...s, call_not_connected_labels: items }))}
        />
        <EditableItemList
          label="Call Connected"
          sectionIcon={<Phone className="h-4 w-4" />}
          accent="emerald"
          items={settings.call_connected_labels}
          addLabel="Add outcome"
          onChange={(items) => setSettings((s) => ({ ...s, call_connected_labels: items }))}
        />
      </div>

      {/* Close Enquiry Reasons */}
      <div className="space-y-3">
        <div>
          <p className="text-[14px] font-semibold text-slate-900">Close Enquiry Reasons</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            The dropdown agents must choose from when closing a lead.
          </p>
        </div>
        <EditableItemList
          label="Close Reasons"
          sectionIcon={<XCircle className="h-4 w-4" />}
          accent="rose"
          items={settings.close_enquiry_reasons}
          addLabel="Add reason"
          onChange={(items) => setSettings((s) => ({ ...s, close_enquiry_reasons: items }))}
        />
      </div>

      {/* Lead Sources */}
      <div className="space-y-3">
        <div>
          <p className="text-[14px] font-semibold text-slate-900">Lead Sources</p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            The source options shown when creating or editing a lead. WhatsApp and Instagram get their real brand icons automatically.
          </p>
        </div>
        <EditableItemList
          label="Sources"
          sectionIcon={<Globe className="h-4 w-4" />}
          accent="indigo"
          items={settings.lead_sources}
          addLabel="Add source"
          onChange={(items) => setSettings((s) => ({ ...s, lead_sources: items }))}
        />
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        <button
          type="button"
          onClick={() =>
            setSettings((s) => ({
              ...s,
              score_options: DEF_SCORE_OPTIONS,
              call_not_connected_labels: DEF_NOT_CONNECTED,
              call_connected_labels: DEF_CONNECTED,
              close_enquiry_reasons: DEF_CLOSE_REASONS,
            }))
          }
          className="rounded-lg border border-slate-200 px-5 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
