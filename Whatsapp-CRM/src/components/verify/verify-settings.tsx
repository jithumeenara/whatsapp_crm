"use client"

/**
 * Settings for one "check details" list: which Google Sheet and tab, which
 * columns hold the name, phone and email, what the person sees and may
 * correct, the deadline, and the messages that carry their private link.
 * Any sheet, any business: columns are chosen by their headers.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { GoogleSheetChooser } from "@/components/shared/google-sheet-chooser"
import { GoogleSheetsIcon } from "@/components/shared/google-icons"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { FORM_LANGS } from "@/lib/data-store/form-i18n"
import { isSensitiveColumn, REF_HEADER, STATUS_HEADER } from "@/lib/verify/sheet-verify"

export interface VerificationSettings {
  id?: string
  name: string
  spreadsheet_id: string
  spreadsheet_name: string | null
  tab_title: string
  name_column: string | null
  phone_column: string | null
  email_column: string | null
  show_columns: string[]
  edit_columns: string[]
  filter_column: string | null
  filter_value: string | null
  deadline: string | null
  language: string
  intro: string | null
  template_name: string | null
  template_params: string[]
  sms_text: string | null
  email_subject: string | null
  email_text: string | null
  help_whatsapp_config_id: string | null
  help_whatsapp_text: string | null
  help_call_phone: string | null
  status: "active" | "closed"
}

export const EMPTY_SETTINGS: VerificationSettings = {
  name: "", spreadsheet_id: "", spreadsheet_name: null, tab_title: "",
  name_column: null, phone_column: null, email_column: null, show_columns: [], edit_columns: [],
  filter_column: null, filter_value: null, deadline: null, language: "en", intro: null,
  template_name: null, template_params: [], sms_text: null, email_subject: null, email_text: null,
  help_whatsapp_config_id: null, help_whatsapp_text: null, help_call_phone: null, status: "active",
}

interface WaNumber { id: string; label: string }

interface TemplateLite { name: string; language?: string | null; body_text?: string | null; buttons?: unknown }

const FIELD = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13.5px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
const AREA = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
const VALUE_NAMES: Record<string, string> = {
  name: "Their name", link: "Their private link", deadline: "The deadline", business: "Business name", ref: "Their reference",
}

/** A date-time box's value from a stored ISO time, in this browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

export function VerifySettings({ initial, onSaved }: { initial: VerificationSettings; onSaved(id: string): void }) {
  const [s, setS] = useState<VerificationSettings>(initial)
  const set = (p: Partial<VerificationSettings>) => setS((c) => ({ ...c, ...p }))
  const [choosing, setChoosing] = useState(false)
  const [tabs, setTabs] = useState<string[]>([])
  const [headers, setHeaders] = useState<string[] | null>(null)
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null)
  const [numbers, setNumbers] = useState<WaNumber[] | null>(null)
  const [saving, setSaving] = useState(false)
  const loadSeq = useRef(0)

  // The sheet's tabs and the chosen tab's headers (newest answer wins).
  useEffect(() => {
    if (!s.spreadsheet_id) return
    const seq = ++loadSeq.current
    const t = setTimeout(() => {
      setHeaders(null)
      const tab = s.tab_title ? `&tab=${encodeURIComponent(s.tab_title)}` : ""
      apiFetch(`/api/google/sheets/preview?picked=1&spreadsheet=${encodeURIComponent(s.spreadsheet_id)}${tab}`)
        .then((r) => r.json())
        .then((d: { tabs?: Array<{ title: string }>; tab?: string; headers?: string[] }) => {
          if (seq !== loadSeq.current) return
          const list = (d.tabs ?? []).map((x) => x.title).filter(Boolean)
          setTabs(list)
          if (!s.tab_title && d.tab) set({ tab_title: d.tab })
          setHeaders((d.headers ?? []).filter((h) => h.trim() && !/^column \d+$/i.test(h) && h !== REF_HEADER && h !== STATUS_HEADER))
        })
        .catch((err) => {
          console.error("[verify-settings] sheet read failed:", err)
          if (seq === loadSeq.current) { setHeaders([]); toast.error(errorText(err, "Could not read that sheet")) }
        })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.spreadsheet_id, s.tab_title])

  useEffect(() => {
    let live = true
    apiFetch("/api/whatsapp/templates?status=APPROVED", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { templates?: TemplateLite[] }) => { if (live) setTemplates(Array.isArray(d.templates) ? d.templates : []) })
      .catch((err) => { console.error("[verify-settings] templates failed:", err); if (live) setTemplates([]) })
    return () => { live = false }
  }, [])

  // This account's connected numbers, for the WhatsApp button on the page.
  useEffect(() => {
    let live = true
    apiFetch("/api/whatsapp/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { configs?: Array<{ id: string; config?: { label?: string | null }; phone_info?: { display_phone_number?: string } }> }) => {
        if (!live) return
        setNumbers((d.configs ?? []).map((c) => ({ id: c.id, label: [c.config?.label, c.phone_info?.display_phone_number].filter(Boolean).join(" · ") || "WhatsApp number" })))
      })
      .catch((err) => { console.error("[verify-settings] numbers failed:", err); if (live) setNumbers([]) })
    return () => { live = false }
  }, [])

  const template = templates?.find((t) => t.name === s.template_name) ?? null
  const varCount = useMemo(() => {
    const nums = [...(template?.body_text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
    return nums.length ? Math.max(...nums) : 0
  }, [template])
  const urlButton = useMemo(() => {
    const buttons = Array.isArray(template?.buttons) ? (template?.buttons as Array<{ type?: string; url?: string }>) : []
    return buttons.some((b) => String(b?.type ?? "").toUpperCase() === "URL" && /\{\{\s*1\s*\}\}/.test(String(b?.url ?? "")))
  }, [template])
  const carriesLink = urlButton || s.template_params.slice(0, varCount).includes("link")

  const cols = headers ?? []
  const contact = new Set([s.phone_column, s.email_column].filter(Boolean))
  const toggle = (list: string[], h: string) => (list.includes(h) ? list.filter((x) => x !== h) : [...list, h])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const body = JSON.stringify({ ...s, deadline: s.deadline })
      const res = s.id
        ? await apiFetch(`/api/sheet-verifications/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
        : await apiFetch("/api/sheet-verifications", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      const d = (await res.json()) as { id?: string; verification?: { id: string } }
      toast.success("Saved")
      onSaved(s.id ?? d.id ?? d.verification?.id ?? "")
    } catch (err) {
      console.error("[verify-settings] save failed:", err)
      toast.error(errorText(err, "Could not save"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Name">
        <input value={s.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} placeholder="e.g. December batch — final check" aria-label="Name" name="verify-name" autoComplete="off" className={FIELD} />
      </Section>

      <Section title="Google Sheet" hint="The list stays in your sheet. Two columns are added to it: Verify ref and Verify status.">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setChoosing(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13.5px] font-medium text-slate-700 hover:bg-slate-50">
            <GoogleSheetsIcon className="h-4 w-4" /> {s.spreadsheet_id ? s.spreadsheet_name || "Change sheet" : "Choose a sheet"}
          </button>
          {tabs.length > 0 && (
            <select value={s.tab_title} onChange={(e) => set({ tab_title: e.target.value, name_column: null, phone_column: null, email_column: null, show_columns: [], edit_columns: [], filter_column: null })} aria-label="Tab" className={`${FIELD} w-auto min-w-40`}>
              {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {s.spreadsheet_id && headers === null && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Reading the sheet" />}
        </div>
      </Section>

      {s.spreadsheet_id && cols.length > 0 && (
        <Section title="Columns" hint="Found by their headers, so moving columns later is fine.">
          <div className="grid gap-3 sm:grid-cols-3">
            {([["name_column", "Name"], ["phone_column", "Phone (WhatsApp / SMS)"], ["email_column", "Email (optional)"]] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-[12.5px] text-slate-600">
                {label}
                <select value={s[k] ?? ""} onChange={(e) => set({ [k]: e.target.value || null } as Partial<VerificationSettings>)} className={FIELD}>
                  <option value="">—</option>
                  {cols.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div>
            <p className="text-[12.5px] font-medium text-slate-700">What each person sees, and what they may correct</p>
            <ul className="mt-2 flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
              {cols.filter((h) => h !== s.name_column).map((h) => {
                const shown = s.show_columns.includes(h)
                const locked = contact.has(h) || isSensitiveColumn(h)
                return (
                  <li key={h} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-slate-800">{h}</span>
                    <label className="flex items-center gap-1.5 text-slate-600">
                      <input type="checkbox" checked={shown} onChange={() => set({ show_columns: toggle(s.show_columns, h), edit_columns: shown ? s.edit_columns.filter((x) => x !== h) : s.edit_columns })} className="h-4 w-4 accent-[var(--primary)]" />
                      Show
                    </label>
                    <label className={`flex items-center gap-1.5 ${locked || !shown ? "text-slate-300" : "text-slate-600"}`} title={locked ? "Numbers, ID and bank details are shown masked and cannot be changed" : undefined}>
                      <input type="checkbox" disabled={locked || !shown} checked={!locked && shown && s.edit_columns.includes(h)} onChange={() => set({ edit_columns: toggle(s.edit_columns, h) })} className="h-4 w-4 accent-[var(--primary)]" />
                      May correct
                    </label>
                  </li>
                )
              })}
              {s.name_column && (
                <li className="flex items-center gap-4 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-slate-800">{s.name_column} <span className="text-slate-400">· always shown</span></span>
                  <label className="flex items-center gap-1.5 text-slate-600">
                    <input type="checkbox" checked={s.edit_columns.includes(s.name_column)} onChange={() => set({ edit_columns: toggle(s.edit_columns, s.name_column!) })} className="h-4 w-4 accent-[var(--primary)]" />
                    May correct
                  </label>
                </li>
              )}
            </ul>
            <p className="mt-1.5 text-[11.5px] text-slate-400">Phone, email, ID and bank columns are always shown masked and can never be changed from the link. Other columns you tick appear in full on their page — tick only what they need to check.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
              Only rows where (optional)
              <select value={s.filter_column ?? ""} onChange={(e) => set({ filter_column: e.target.value || null })} className={FIELD}>
                <option value="">Every row</option>
                {cols.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            {s.filter_column && (
              <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
                is exactly
                <input value={s.filter_value ?? ""} onChange={(e) => set({ filter_value: e.target.value })} maxLength={200} autoComplete="off" className={FIELD} />
              </label>
            )}
          </div>
        </Section>
      )}

      <Section title="The page they open" hint="In their language. After the deadline the link stops working and nothing can be changed.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
            Deadline
            <input type="datetime-local" value={toLocalInput(s.deadline)} onChange={(e) => set({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null })} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
            Page language
            <select value={s.language} onChange={(e) => set({ language: e.target.value })} className={FIELD}>
              {FORM_LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}{l.native !== l.name ? ` · ${l.native}` : ""}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
          A line at the top (optional)
          <textarea rows={2} value={s.intro ?? ""} onChange={(e) => set({ intro: e.target.value })} maxLength={1000} className={AREA} dir="auto" />
        </label>
      </Section>

      <Section title="WhatsApp" hint="An approved Utility template. Their private link goes in a {{n}} of the text, or in a link button whose address ends in {{1}}.">
        <select value={s.template_name ?? ""} onChange={(e) => set({ template_name: e.target.value || null, template_params: [] })} aria-label="WhatsApp template" className={FIELD}>
          <option value="">{templates === null ? "Loading…" : templates.length ? "Choose a template…" : "No approved templates yet"}</option>
          {(templates ?? []).map((t) => <option key={`${t.name}-${t.language ?? ""}`} value={t.name}>{t.name}</option>)}
        </select>
        {template?.body_text && <p className="whitespace-pre-line rounded-lg bg-emerald-50/70 px-3 py-2 text-[12.5px] leading-relaxed text-slate-700" dir="auto">{template.body_text}</p>}
        {Array.from({ length: varCount }, (_, i) => (
          <label key={i} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2 text-[12.5px] text-slate-600">
            <code className="rounded bg-slate-100 px-1 text-center">{`{{${i + 1}}}`}</code>
            <select
              value={s.template_params[i] ?? ""}
              onChange={(e) => { const next = [...s.template_params]; while (next.length < varCount) next.push(""); next[i] = e.target.value; set({ template_params: next.slice(0, varCount) }) }}
              aria-label={`What fills {{${i + 1}}}`}
              className={FIELD}
            >
              <option value="">— (a dash)</option>
              {Object.entries(VALUE_NAMES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              {cols.filter((h) => !isSensitiveColumn(h) && !contact.has(h)).map((h) => <option key={h} value={`col:${h}`}>{h}</option>)}
            </select>
          </label>
        ))}
        {template && !carriesLink && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Put “Their private link” in one of the {"{{n}}"} above — otherwise people get no link.
          </p>
        )}
      </Section>

      <Section title="Help buttons on their page" hint="A Call button, and a WhatsApp button that opens a chat with your number with your text already typed — a chatbot trigger word works here. Leave empty to hide a button.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
            WhatsApp number
            <select value={s.help_whatsapp_config_id ?? ""} onChange={(e) => set({ help_whatsapp_config_id: e.target.value || null })} className={FIELD}>
              <option value="">{numbers === null ? "Loading…" : "No WhatsApp button"}</option>
              {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
            Message already typed
            <input value={s.help_whatsapp_text ?? ""} onChange={(e) => set({ help_whatsapp_text: e.target.value })} maxLength={200} disabled={!s.help_whatsapp_config_id} placeholder="e.g. HELP or a chatbot trigger word…" autoComplete="off" name="verify-help-text" className={`${FIELD} disabled:bg-slate-50`} dir="auto" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
          Number for the Call button
          <input value={s.help_call_phone ?? ""} onChange={(e) => set({ help_call_phone: e.target.value })} maxLength={30} type="tel" inputMode="tel" placeholder="Empty: the phone in your company profile" autoComplete="off" name="verify-help-phone" className={FIELD} />
        </label>
      </Section>

      <Section title="SMS and email (for people WhatsApp does not reach)" hint="Use {{name}}, {{link}}, {{deadline}}, {{business}} and {{ref}}. An SMS in India must match your DLT-approved text exactly.">
        <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
          SMS text
          <textarea rows={2} value={s.sms_text ?? ""} onChange={(e) => set({ sms_text: e.target.value })} maxLength={600} placeholder="Dear {{name}}, please check your details by {{deadline}}: {{link}} - {{business}}" className={AREA} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
          Email subject
          <input value={s.email_subject ?? ""} onChange={(e) => set({ email_subject: e.target.value })} maxLength={150} placeholder="Please check your details" autoComplete="off" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">
          Email text
          <textarea rows={4} value={s.email_text ?? ""} onChange={(e) => set({ email_text: e.target.value })} maxLength={3000} placeholder={"Dear {{name}},\n\nPlease check your details by {{deadline}}:\n{{link}}\n\n{{business}}"} className={AREA} />
        </label>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {s.id && (
          <label className="mr-auto flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={s.status === "closed"} onChange={(e) => set({ status: e.target.checked ? "closed" : "active" })} className="h-4 w-4 accent-[var(--primary)]" />
            Closed (links stop working)
          </label>
        )}
        <button type="button" onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Save
        </button>
      </div>

      {choosing && (
        <GoogleSheetChooser
          subtitle="The list of people to check"
          returnTo="/data/verify"
          onClose={() => setChoosing(false)}
          onChosen={(c) => { setChoosing(false); set({ spreadsheet_id: c.id, spreadsheet_name: c.name, tab_title: "", name_column: null, phone_column: null, email_column: null, show_columns: [], edit_columns: [], filter_column: null }) }}
        />
      )}
    </div>
  )
}
