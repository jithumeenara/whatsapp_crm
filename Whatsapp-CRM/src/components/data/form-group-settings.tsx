"use client"

/**
 * Public form settings for "several people in one form" and the WhatsApp
 * confirmations. Both optional; both off until the business turns them on.
 */

import { useEffect, useState } from "react"
import { ClipboardCheck, MessageCircle, Users } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { GROUP_HARD_MAX, isSensitiveQuestion, type FormConfirm, type FormGroup } from "@/lib/data-store/form-group"
import type { ConfirmPage } from "@/lib/data-store/public-form"

const FIELD =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

export interface QuestionLite {
  key: string
  label: string
  type: string
}

/** The switch, the name for one person, and how many. Which questions are
 *  per person is ticked in the Questions list. */
export function GroupSettings({
  group, perPersonCount, onChange,
}: {
  group: FormGroup
  perPersonCount: number
  onChange(g: FormGroup): void
}) {
  const set = (p: Partial<FormGroup>) => onChange({ ...group, ...p })
  return (
    <>
      <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
        <span>
          <span className="flex items-center gap-1.5 font-medium text-slate-800"><Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Several people in one form</span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-400">
            Some questions once (programme, month, district), then “Add participant” for each person. Every person is saved as their own row.
          </span>
        </span>
        <Switch checked={group.enabled} onCheckedChange={(v) => set({ enabled: !!v })} aria-label="Several people in one form" />
      </label>
      {group.enabled && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-slate-600">
              One person is a
              <input value={group.label} onChange={(e) => set({ label: e.target.value })} maxLength={40} placeholder="Participant" autoComplete="off" name="group-label" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-slate-600">
              Fewest
              <input type="number" inputMode="numeric" name="group-min" autoComplete="off" min={1} max={group.max} value={group.min}
                onChange={(e) => set({ min: Math.max(1, Math.min(group.max, Number(e.target.value) || 1)) })} className={`${FIELD} tabular-nums`} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-slate-600">
              Most
              <input type="number" inputMode="numeric" name="group-max" autoComplete="off" min={1} max={GROUP_HARD_MAX} value={group.max}
                onChange={(e) => { const max = Math.max(1, Math.min(GROUP_HARD_MAX, Number(e.target.value) || 1)); set({ max, min: Math.min(group.min, max) }) }} className={`${FIELD} tabular-nums`} />
            </label>
          </div>
          {perPersonCount === 0 ? (
            <p role="status" className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">
              Now mark the questions asked for each person — tap “Once” next to a question in Questions above to turn it into “Per person”.
            </p>
          ) : (
            <p className="text-[11.5px] text-slate-500">
              {perPersonCount} question{perPersonCount === 1 ? "" : "s"} asked per person; the rest once. “Most answers” counts people.
            </p>
          )}
        </>
      )}
    </>
  )
}

/**
 * After submitting: the short thank-you (off), or a full confirmation with
 * the answers asked once, everyone registered, the reference, the time and
 * a PDF button. Which questions show is the business's choice.
 */
export function ConfirmPageSettings({
  value, onceQuestions, personQuestions, groupOn, onChange,
}: {
  value: ConfirmPage
  onceQuestions: QuestionLite[]
  personQuestions: QuestionLite[]
  groupOn: boolean
  onChange(v: ConfirmPage): void
}) {
  const set = (p: Partial<ConfirmPage>) => onChange({ ...value, ...p })
  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
  const pick = (title: string, hint: string, questions: QuestionLite[], chosen: string[], key: "summary_keys" | "person_keys") => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[12px] font-medium text-slate-700">{title}</legend>
      <p className="text-[11.5px] text-slate-400">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q) => {
          const on = chosen.includes(q.key)
          return (
            <button
              key={q.key}
              type="button"
              aria-pressed={on}
              onClick={() => set({ [key]: toggle(chosen, q.key) } as Partial<ConfirmPage>)}
              className={`h-7 max-w-full truncate rounded-full px-2.5 text-[11.5px] font-medium transition-colors ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
            >
              {q.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
  return (
    <>
      <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
        <span>
          <span className="flex items-center gap-1.5 font-medium text-slate-800"><ClipboardCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Full confirmation after sending</span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-400">
            Shows what they sent — the details, everyone added, the reference and time — with a button to save it as a PDF. Off: the short thank-you. Words like “Received” or “Fill in another” can be changed under Languages → Buttons and messages.
          </span>
        </span>
        <Switch checked={value.enabled} onCheckedChange={(v) => set({ enabled: !!v })} aria-label="Full confirmation after sending" />
      </label>
      {value.enabled && (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-slate-600">
            Heading
            <input value={value.title ?? ""} onChange={(e) => set({ title: e.target.value || null })} maxLength={120} placeholder="Sent successfully — e.g. Registration successful" name="confirm-title" autoComplete="off" className={FIELD} />
          </label>
          {onceQuestions.length > 0 && pick("Details shown", "None chosen: every answer asked once. ID and bank account numbers always show masked.", onceQuestions, value.summary_keys, "summary_keys")}
          {groupOn && personQuestions.length > 0 && pick("Columns for each person", "Their name always comes first. None chosen: the first few questions.", personQuestions, value.person_keys, "person_keys")}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-slate-600">
              Reference starts with (optional)
              <input
                value={value.ref_prefix ?? ""}
                onChange={(e) => set({ ref_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || null })}
                maxLength={8}
                placeholder="REG"
                name="confirm-prefix"
                autoComplete="off"
                className={`${FIELD} font-mono uppercase`}
              />
            </label>
            <span className="pb-2 font-mono text-[12px] text-slate-500">{value.ref_prefix ? `${value.ref_prefix}-` : ""}7K2M-9QXD-R5TB</span>
          </div>
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-700">
            Show the date and time
            <Switch checked={value.show_time} onCheckedChange={(v) => set({ show_time: !!v })} aria-label="Show the date and time" />
          </label>
          <label className="flex items-center justify-between gap-3 text-[12.5px] text-slate-700">
            “Download / print (PDF)” button
            <Switch checked={value.allow_print} onCheckedChange={(v) => set({ allow_print: !!v })} aria-label="Download or print button" />
          </label>
        </>
      )}
    </>
  )
}

interface TemplateLite {
  name: string
  language?: string | null
  body_text?: string | null
  category?: string | null
}

/** {{1}}, {{2}}… in a template's body, highest first counted. Named
 *  variables are not filled from here. */
function variableCount(body: string | null | undefined): { count: number; named: boolean } {
  const text = body ?? ""
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  const named = /\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/i.test(text)
  return { count: nums.length ? Math.max(...nums) : 0, named }
}

/** The approved templates, read once per panel. */
export function useApprovedTemplates(): { templates: TemplateLite[] | null; error: string | null } {
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    apiFetch("/api/whatsapp/templates?status=APPROVED", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { templates?: TemplateLite[] | null }) => { if (live) setTemplates(Array.isArray(d.templates) ? d.templates : []) })
      .catch((err) => {
        console.error("[form-confirm] templates failed:", err)
        if (live) { setTemplates([]); setError(errorText(err, "Could not load your WhatsApp templates.")) }
      })
    return () => { live = false }
  }, [])
  return { templates, error }
}

const VALUE_LABELS: Record<string, string> = {
  names: "Names of everyone added",
  count: "How many people",
  person_name: "This person's name",
  reference: "Reference number",
  business: "Business name",
}

/** One confirmation: template, the number it goes to, what fills each variable. */
export function ConfirmSettings({
  title, hint, value, templates, phoneQuestions, valueQuestions, perPerson, groupOn, onChange,
}: {
  title: string
  hint: string
  value: FormConfirm | null
  templates: TemplateLite[] | null
  phoneQuestions: QuestionLite[]
  valueQuestions: QuestionLite[]
  perPerson: boolean
  groupOn: boolean
  onChange(v: FormConfirm | null): void
}) {
  const template = templates?.find((t) => t.name === value?.template) ?? null
  const vars = variableCount(template?.body_text)
  const specials = ["names", "count", ...(perPerson ? ["person_name"] : []), "reference", "business"].filter((k) => groupOn || (k !== "names" && k !== "count" && k !== "person_name"))
  const set = (p: Partial<FormConfirm>) => value && onChange({ ...value, ...p })
  const id = title.replace(/\W+/g, "-").toLowerCase()

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
        <span>
          <span className="flex items-center gap-1.5 font-medium text-slate-800"><MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> {title}</span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-400">{hint}</span>
        </span>
        <Switch
          checked={!!value}
          onCheckedChange={(v) => onChange(v ? { template: "", phone_key: phoneQuestions[0]?.key ?? "", params: [] } : null)}
          aria-label={title}
        />
      </label>
      {value && (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-slate-600" htmlFor={`${id}-template`}>
            Approved template (Utility)
            <select id={`${id}-template`} value={value.template} onChange={(e) => set({ template: e.target.value, params: [] })} className={FIELD}>
              <option value="">{templates === null ? "Loading…" : templates.length ? "Choose a template…" : "No approved templates yet"}</option>
              {(templates ?? []).map((t) => (
                <option key={`${t.name}-${t.language ?? ""}`} value={t.name}>{t.name}{t.category ? ` · ${t.category.toLowerCase()}` : ""}</option>
              ))}
            </select>
          </label>
          {!value.template && templates !== null && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">Choose a template — until then no message is sent, and this switch turns itself off when you save.</p>
          )}
          {template?.body_text && (
            <p className="whitespace-pre-line rounded-lg bg-emerald-50/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-slate-700">{template.body_text}</p>
          )}
          {vars.named && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">This template uses named variables. Choose one written with {"{{1}}"}, {"{{2}}"}… so the form can fill it.</p>
          )}
          <label className="flex flex-col gap-1 text-[12px] text-slate-600" htmlFor={`${id}-phone`}>
            Send to the number in
            <select id={`${id}-phone`} value={value.phone_key} onChange={(e) => set({ phone_key: e.target.value })} className={FIELD}>
              {!perPerson && <option value="">Only someone sent a personal link</option>}
              {phoneQuestions.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
          </label>
          {perPerson && phoneQuestions.length === 0 && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">Mark a phone question as “Per person” first — each message goes to that person&apos;s own number.</p>
          )}
          {vars.count > 0 && (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: vars.count }, (_, i) => (
                <label key={i} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2 text-[12px] text-slate-600">
                  <code className="rounded bg-slate-100 px-1 text-center text-[11.5px]">{`{{${i + 1}}}`}</code>
                  <select
                    value={value.params[i] ?? ""}
                    onChange={(e) => { const next = [...value.params]; while (next.length < vars.count) next.push(""); next[i] = e.target.value; set({ params: next.slice(0, vars.count) }) }}
                    aria-label={`What fills {{${i + 1}}}`}
                    className={FIELD}
                  >
                    <option value="">— (a dash)</option>
                    {specials.map((k) => <option key={k} value={k}>{VALUE_LABELS[k]}</option>)}
                    {/* ID numbers and bank details never go to a number typed into a public form. */}
                    {valueQuestions.filter((q) => !isSensitiveQuestion(q)).map((q) => <option key={q.key} value={`field:${q.key}`}>{q.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {value.template && !template && templates && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">“{value.template}” is not an approved template on this account any more. Choose another.</p>
          )}
        </>
      )}
    </div>
  )
}
