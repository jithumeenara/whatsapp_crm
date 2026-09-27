"use client"

/**
 * "Tell me when a new record arrives" for one table — in the app, by
 * email, on WhatsApp. The rules for what is sent live in
 * lib/data-store/record-alert.ts; this is only the form for them.
 */

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BellRing, Loader2, Mail, MessageCircle, Plus, ShieldCheck, Smartphone } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { SidePanel, PanelSection, ChipList } from "./side-panel"
import { ALERTABLE_SOURCES, RECORD_SOURCE_LABELS, type RecordSource } from "@/lib/data-store/sources"
import {
  EMPTY_ALERT_CONFIG,
  MAX_ALERT_EMAILS,
  MAX_ALERT_NUMBERS,
  type RecordAlertConfig,
} from "@/lib/data-store/record-alert"
import type { DataField } from "@/lib/data-store/types"

interface Member {
  user_id: string
  full_name: string
  role: string
}

const FIELD =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

export function RecordAlertsPanel({
  tableId,
  tableName,
  fields,
  onClose,
}: {
  tableId: string
  tableName: string
  fields: DataField[]
  onClose: () => void
}) {
  const [config, setConfig] = useState<RecordAlertConfig>(EMPTY_ALERT_CONFIG)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [email, setEmail] = useState("")
  const [number, setNumber] = useState("")

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/data-tables/${tableId}/alerts`, { cache: "no-store" }),
      fetch("/api/account/members", { cache: "no-store" }),
    ])
      .then(async ([a, m]) => {
        if (cancelled) return
        if (a.status === 403) {
          setDenied(true)
          return
        }
        const data = (await a.json().catch(() => ({}))) as { config?: RecordAlertConfig }
        if (data.config) setConfig(data.config)
        const mem = (await m.json().catch(() => ({}))) as { members?: Member[] }
        setMembers(mem.members ?? [])
      })
      .catch(() => toast.error("Could not load alert settings"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tableId])

  function patch(p: Partial<RecordAlertConfig>) {
    setConfig((c) => ({ ...c, ...p }))
  }

  function toggleSource(s: RecordSource) {
    patch({ sources: config.sources.includes(s) ? config.sources.filter((x) => x !== s) : [...config.sources, s] })
  }

  function addEmail() {
    const e = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
      toast.error("That does not look like an email address")
      return
    }
    if (config.emails.includes(e) || config.emails.length >= MAX_ALERT_EMAILS) return
    patch({ emails: [...config.emails, e] })
    setEmail("")
  }

  function addNumber() {
    const n = number.replace(/[^\d]/g, "")
    if (n.length < 8 || n.length > 15) {
      toast.error("Country code first, then the number — e.g. 919876543210")
      return
    }
    if (config.whatsapp_numbers.includes(n) || config.whatsapp_numbers.length >= MAX_ALERT_NUMBERS) return
    patch({ whatsapp_numbers: [...config.whatsapp_numbers, n] })
    setNumber("")
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/alerts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      })
      const data = (await res.json().catch(() => ({}))) as { config?: RecordAlertConfig; error?: string }
      if (!res.ok) throw new Error(data.error || "Could not save")
      if (data.config) setConfig(data.config)
      toast.success(data.config?.enabled ? "Alerts are on" : "Alert settings saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const conditionFields = fields.filter((f) => !["section_header", "html_block", "file", "image", "signature", "password"].includes(f.field_type))
  const noChannel =
    config.enabled &&
    config.push_user_ids.length === 0 &&
    config.emails.length === 0 &&
    config.whatsapp_numbers.length === 0

  return (
    <SidePanel
      title="New record alerts"
      subtitle={tableName}
      icon={<BellRing className="h-4.5 w-4.5" />}
      onClose={onClose}
      footer={
        !loading && !denied ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-slate-400">
              {noChannel ? "Pick at least one way to be told." : "Imports are never alerted."}
            </p>
            <button
              onClick={save}
              disabled={saving}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : denied ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-500">
          Only an admin can change who is alerted.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 rounded-2xl bg-primary/5 p-4">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-800">Tell us when a new record arrives</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                A customer registering on WhatsApp, a Flow or the web form reaches your team straight away.
              </p>
            </div>
            <Switch checked={config.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
          </div>

          {config.enabled && (
            <>
              <PanelSection
                title="Which records"
                hint="Leave all unticked to be told about every record a person adds."
              >
                <div className="flex flex-wrap gap-1.5">
                  {ALERTABLE_SOURCES.map((s) => {
                    const on = config.sources.includes(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSource(s)}
                        aria-pressed={on}
                        className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                          on
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {RECORD_SOURCE_LABELS[s]}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <select
                    id="alert-condition-field"
                    value={config.condition?.field_key ?? ""}
                    onChange={(e) =>
                      patch({
                        condition: e.target.value
                          ? { field_key: e.target.value, equals: config.condition?.equals ?? "" }
                          : null,
                      })
                    }
                    className={FIELD}
                    aria-label="Only when this field"
                  >
                    <option value="">Any values</option>
                    {conditionFields.map((f) => (
                      <option key={f.id} value={f.field_key}>
                        Only when {f.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-[12px] text-slate-400">is</span>
                  <input
                    id="alert-condition-value"
                    value={config.condition?.equals ?? ""}
                    disabled={!config.condition}
                    onChange={(e) =>
                      config.condition && patch({ condition: { ...config.condition, equals: e.target.value } })
                    }
                    placeholder="e.g. PSC"
                    maxLength={200}
                    className={`${FIELD} disabled:bg-slate-50`}
                  />
                </div>
              </PanelSection>

              <PanelSection
                title="In the app"
                hint="A notification on their browser or phone. Each person turns notifications on once, in Settings → Notifications."
              >
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                  <Smartphone className="h-3.5 w-3.5" /> Tell these team members
                </div>
                <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                  {members.map((m) => {
                    const on = config.push_user_ids.includes(m.user_id)
                    return (
                      <label
                        key={m.user_id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            patch({
                              push_user_ids: on
                                ? config.push_user_ids.filter((u) => u !== m.user_id)
                                : [...config.push_user_ids, m.user_id],
                            })
                          }
                          className="h-4 w-4 accent-[var(--primary)]"
                        />
                        <span className="flex-1 truncate">{m.full_name || "Team member"}</span>
                        <span className="text-[11px] capitalize text-slate-400">{m.role}</span>
                      </label>
                    )
                  })}
                  {members.length === 0 && <p className="text-[12px] text-slate-400">No team members found.</p>}
                </div>
              </PanelSection>

              <PanelSection
                title="Email"
                hint="Sent from the email channel connected in Settings → Channels."
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="alert-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addEmail()
                        }
                      }}
                      placeholder="office@example.com"
                      className={`${FIELD} pl-8`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addEmail}
                    disabled={config.emails.length >= MAX_ALERT_EMAILS}
                    className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[12.5px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
                <ChipList items={config.emails} onRemove={(v) => patch({ emails: config.emails.filter((x) => x !== v) })} />
              </PanelSection>

              <PanelSection title="WhatsApp" hint="To staff numbers, from your WhatsApp business number.">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MessageCircle className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="alert-number"
                      value={number}
                      inputMode="numeric"
                      onChange={(e) => setNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addNumber()
                        }
                      }}
                      placeholder="919876543210"
                      className={`${FIELD} pl-8 font-mono`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addNumber}
                    disabled={config.whatsapp_numbers.length >= MAX_ALERT_NUMBERS}
                    className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[12.5px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
                <ChipList
                  mono
                  items={config.whatsapp_numbers}
                  onRemove={(v) => patch({ whatsapp_numbers: config.whatsapp_numbers.filter((x) => x !== v) })}
                />
                {config.whatsapp_numbers.length > 0 && (
                  <>
                    <label htmlFor="alert-template" className="text-[12px] text-slate-600">
                      Approved template name (recommended)
                    </label>
                    <input
                      id="alert-template"
                      value={config.whatsapp_template ?? ""}
                      onChange={(e) => patch({ whatsapp_template: e.target.value.trim() || null })}
                      placeholder="new_record_alert"
                      className={`${FIELD} font-mono`}
                    />
                    <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
                      {config.whatsapp_template
                        ? "The template needs three variables, in this order: the table name, the details, and where it came from."
                        : "Without a template, WhatsApp only delivers to a staff number that messaged your business number in the last 24 hours — Meta's rule. Add an approved Utility template so alerts always arrive."}
                    </p>
                  </>
                )}
              </PanelSection>

              <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-[12px] leading-relaxed text-slate-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                Alerts carry the first few details only. Aadhaar, PAN, bank, card and password fields are masked to
                their last four characters — open the record for the rest. At most 20 alerts per table every 10 minutes.
              </p>
            </>
          )}
        </div>
      )}
    </SidePanel>
  )
}
