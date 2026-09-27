"use client"

/**
 * "Get Data" — turning a table into a public form: the link and its QR
 * code, what the form asks, when it closes, and personal links that file
 * an answer under a named customer.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ChevronDown, Copy, ExternalLink, Link2, Loader2, QrCode, RefreshCw, Search, Send, ShieldCheck, Sparkles, UserRound, Wand2,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SidePanel, PanelSection } from "./side-panel"
import {
  DEFAULT_CONSENT,
  EMPTY_FORM_CONFIG,
  WEB_FORM_DISPLAY_TYPES,
  WEB_FORM_FIELD_TYPES,
  type TableFormConfig,
} from "@/lib/data-store/public-form"
import { getSelectItems, type DataField } from "@/lib/data-store/types"
import { effectiveRules, parseRules, type FieldRule, type FormBrand } from "@/lib/data-store/form-logic"
import type { FormSource } from "@/lib/data-store/form-logic"
import { FormBrandEditor, type LogoPreview } from "./form-brand-editor"
import { FormRuleEditor, type EarlierQuestion } from "./form-rule-editor"
import { SortableList, DragHandle } from "./sortable-list"

const FIELD =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

interface ContactHit {
  id: string
  name: string | null
  phone: string
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Link copied")
  } catch {
    toast.error("Could not copy — select the link and copy it")
  }
}

export function PublicFormPanel({
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
  const [config, setConfig] = useState<TableFormConfig>(EMPTY_FORM_CONFIG)
  const [path, setPath] = useState<string | null>(null)
  const [responses, setResponses] = useState(0)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [confirmNewLink, setConfirmNewLink] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ContactHit[]>([])
  const [personal, setPersonal] = useState<{ url: string; contact: ContactHit } | null>(null)
  const [sources, setSources] = useState<FormSource[]>([])
  const [logo, setLogo] = useState<LogoPreview | null>(null)
  const [ruleOpen, setRuleOpen] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const url = path ? `${origin}${path}` : null
  // Questions, plus section headings that split a long form into parts.
  const formFields = fields.filter(
    (f) => WEB_FORM_FIELD_TYPES.has(f.field_type) || WEB_FORM_DISPLAY_TYPES.has(f.field_type),
  )
  const questionCount = formFields.filter((f) => WEB_FORM_FIELD_TYPES.has(f.field_type)).length

  const apply = useCallback((data: {
    config?: TableFormConfig
    path?: string | null
    responses?: number
    sources?: FormSource[]
    logo?: LogoPreview | null
  }) => {
    if (data.config) setConfig(data.config)
    if (data.path !== undefined) setPath(data.path)
    if (typeof data.responses === "number") setResponses(data.responses)
    if (Array.isArray(data.sources)) setSources(data.sources)
    if (data.logo !== undefined) setLogo(data.logo)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/data-tables/${tableId}/form`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 403) {
          setDenied(true)
          return
        }
        apply(await res.json())
      })
      .catch(() => toast.error("Could not load the form settings"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tableId, apply])

  // The QR is drawn in the browser from the link itself — nothing is
  // sent to a third-party QR service.
  useEffect(() => {
    if (!url || !config.enabled) {
      setQr(null)
      return
    }
    let cancelled = false
    import("qrcode")
      .then((QR) => QR.toDataURL(url, { margin: 1, width: 360 }))
      .then((data) => !cancelled && setQr(data))
      .catch(() => !cancelled && setQr(null))
    return () => {
      cancelled = true
    }
  }, [url, config.enabled])

  function patch(p: Partial<TableFormConfig>) {
    setConfig((c) => ({ ...c, ...p }))
  }

  async function save(next: TableFormConfig = config) {
    setSaving(true)
    try {
      const res = await fetch(`/api/data-tables/${tableId}/form`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save")
      apply(data)
      toast.success(next.enabled ? "Form saved — the link is live" : "Form saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  async function newLink() {
    setConfirmNewLink(false)
    const res = await fetch(`/api/data-tables/${tableId}/form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new_link" }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Could not make a new link")
      return
    }
    apply(data)
    setPersonal(null)
    toast.success("New link made — the old one no longer works")
  }

  function search(q: string) {
    setQuery(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?search=${encodeURIComponent(q.trim())}&limit=6`)
        const data = (await res.json()) as { contacts?: ContactHit[] }
        setHits((data.contacts ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone })))
      } catch {
        setHits([])
      }
    }, 250)
  }

  async function makePersonal(contact: ContactHit) {
    const res = await fetch(`/api/data-tables/${tableId}/form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "personal_link", contact_id: contact.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Could not make the link")
      return
    }
    setPersonal({ url: `${origin}${data.path}`, contact })
    setHits([])
    setQuery("")
  }

  const tableOrder = formFields.map((f) => f.field_key)
  // The form's own order: what it asks, in the order it asks it. Empty
  // in the settings means "every question, in the table's order".
  const asked = config.field_keys.length ? config.field_keys.filter((k) => tableOrder.includes(k)) : tableOrder
  const shown = new Set(asked)
  const listed = [
    ...asked.map((k) => formFields.find((f) => f.field_key === k)!).filter(Boolean),
    ...formFields.filter((f) => !shown.has(f.field_key)),
  ]

  /** The questions before `key` on the form, for a rule to look at. */
  function earlierThan(key: string): EarlierQuestion[] {
    const out: EarlierQuestion[] = []
    for (const k of asked) {
      if (k === key) break
      const f = formFields.find((x) => x.field_key === k)
      if (!f || WEB_FORM_DISPLAY_TYPES.has(f.field_type)) continue
      const options = getSelectItems(f.options)
        .map((o) => (typeof o === "string" ? o : String(o?.label ?? o?.value ?? "")))
        .filter(Boolean)
      out.push({ key: f.field_key, label: f.label, options: f.field_type === "boolean" ? ["true", "false"] : options })
    }
    return out
  }

  function setRule(key: string, rule: FieldRule) {
    const rules = { ...config.rules }
    if (rule.filter || rule.fill || rule.show_if) rules[key] = rule
    else delete rules[key]
    patch({ rules })
  }

  function patchBrand(p: Partial<FormBrand>, preview?: LogoPreview | null) {
    patch({ brand: { ...config.brand, ...p } })
    if (preview !== undefined) setLogo(preview)
  }

  /** Saves a new order, and drops any rule it breaks — a rule may only
   *  look at a question asked before it. */
  function setOrder(next: string[]) {
    const same = next.length === tableOrder.length && next.every((k, i) => k === tableOrder[i])
    patch({ field_keys: same ? [] : next, rules: parseRules(config.rules, next) })
  }

  function toggleField(key: string) {
    setOrder(shown.has(key) ? asked.filter((k) => k !== key) : [...asked, key])
  }

  // The links in force: set by hand, plus the automatic ones.
  const questionsInOrder = asked
    .map((k) => formFields.find((f) => f.field_key === k))
    .filter((f): f is DataField => !!f && !WEB_FORM_DISPLAY_TYPES.has(f.field_type))
    .map((f) => ({ key: f.field_key, label: f.label }))
  const effective = effectiveRules(config.rules, questionsInOrder, sources, config.auto_link)

  function setAutoLink(v: boolean) {
    const next = { ...config, auto_link: v }
    setConfig(next)
    void save(next)
  }

  return (
    <SidePanel
      title="Get Data — public form"
      subtitle={tableName}
      icon={<Link2 className="h-4.5 w-4.5" />}
      onClose={onClose}
      footer={
        !loading && !denied ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-slate-400">
              {responses} answer{responses === 1 ? "" : "s"} from the form so far
            </p>
            <button
              onClick={() => save()}
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
          Only an admin can publish a form.
        </p>
      ) : questionCount === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-500">
          Add a text, number, date, phone, email, dropdown or yes/no field first — those are what a form can ask.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 rounded-2xl bg-primary/5 p-4">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-800">Collect answers with a link</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                Anyone with the link can add a row. Share it on WhatsApp, a website, or print the QR code.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => {
                const next = { ...config, enabled: v, consent_text: config.consent_text ?? (v ? DEFAULT_CONSENT : null) }
                setConfig(next)
                void save(next)
              }}
            />
          </div>

          {config.enabled && url && (
            <PanelSection title="The link">
              <div className="flex items-center gap-2">
                <input
                  id="form-link"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${FIELD} font-mono text-[12px]`}
                />
                <button
                  type="button"
                  onClick={() => copy(url)}
                  title="Copy link"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the form"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <div className="flex items-center gap-4">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR code for the form" className="h-28 w-28 rounded-lg border border-slate-200" />
                ) : (
                  <span className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-slate-200">
                    <QrCode className="h-6 w-6 text-slate-300" />
                  </span>
                )}
                <div className="flex flex-col gap-2 text-[12.5px]">
                  {qr && (
                    <a
                      href={qr}
                      download={`${tableName.replace(/[^\w-]+/g, "_")}_form_qr.png`}
                      className="font-medium text-primary hover:underline"
                    >
                      Download QR code
                    </a>
                  )}
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${config.title || tableName}: ${url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Share on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => setConfirmNewLink(true)}
                    className="flex items-center gap-1 text-left text-slate-500 hover:text-rose-600"
                  >
                    <RefreshCw className="h-3 w-3" /> Replace the link
                  </button>
                </div>
              </div>
            </PanelSection>
          )}

          <PanelSection title="What it says">
            <input
              id="form-title"
              value={config.title ?? ""}
              onChange={(e) => patch({ title: e.target.value || null })}
              placeholder={tableName}
              maxLength={120}
              className={FIELD}
              aria-label="Form title"
            />
            <textarea
              id="form-intro"
              value={config.intro ?? ""}
              onChange={(e) => patch({ intro: e.target.value || null })}
              placeholder="A line or two about what this is for (optional)"
              maxLength={1000}
              rows={3}
              className={`${FIELD} h-auto py-2`}
              aria-label="Introduction"
            />
            <input
              id="form-success"
              value={config.success_message ?? ""}
              onChange={(e) => patch({ success_message: e.target.value || null })}
              placeholder="Thank you — your details have been received."
              maxLength={500}
              className={FIELD}
              aria-label="Message after submitting"
            />
          </PanelSection>

          <PanelSection title="Business header" hint="How the top of the form looks: your logo, name and colour.">
            <FormBrandEditor
              brand={config.brand}
              logo={logo}
              placeholderName={tableName}
              onChange={patchBrand}
            />
          </PanelSection>

          <PanelSection
            title="Questions"
            hint={<>Tick what the form asks and drag ⋮⋮ to set the order. <Wand2 className="inline h-3 w-3" /> opens a question&apos;s smart settings. Required, hints and limits are set in Fields.</>}
          >
            <label className="flex items-start justify-between gap-3 rounded-xl bg-primary/5 px-3 py-2.5 text-[12.5px] text-slate-700">
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-slate-800"><Sparkles className="h-3.5 w-3.5 text-primary" /> Link fields automatically</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">
                  By their names: month narrows the programmes, the programme fills group and dates. Change any one below.
                </span>
              </span>
              <Switch checked={config.auto_link} onCheckedChange={setAutoLink} />
            </label>

            <SortableList
              className="flex flex-col gap-1"
              items={listed.filter((f) => shown.has(f.field_key))}
              getKey={(f) => f.field_key}
              getLabel={(f) => f.label}
              onReorder={(keys) => setOrder(keys)}
              renderItem={(f, handle) => {
                const heading = WEB_FORM_DISPLAY_TYPES.has(f.field_type)
                // Shown and edited as in force; editing an automatic link
                // turns it into one set by hand.
                const rule = effective.rules[f.field_key]
                const isAuto = effective.automatic.has(f.field_key)
                const open = ruleOpen === f.field_key
                const smart = [rule?.filter && "narrowed", rule?.fill && (rule.fill.locked ? "filled, locked" : "filled"), rule?.show_if && "conditional", isAuto && "auto"].filter(Boolean)
                return (
                  <div className={open ? "rounded-xl bg-white ring-1 ring-primary/30" : undefined}>
                    <div className={`flex items-center gap-2 rounded-lg px-1 py-1.5 text-[13px] hover:bg-slate-50 ${heading ? "mt-1 font-semibold text-slate-800" : "text-slate-700"}`}>
                      <DragHandle {...handle} />
                      <input
                        type="checkbox"
                        checked
                        onChange={() => toggleField(f.field_key)}
                        aria-label={`Ask “${f.label}”`}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{f.label}</span>
                        {smart.length > 0 && <span className="block truncate text-[11px] font-normal text-primary">{smart.join(" · ")}</span>}
                      </span>
                      {heading && <span className="text-[11px] font-normal text-slate-400">section</span>}
                      {!heading && f.required && <span className="text-[11px] text-rose-500">required</span>}
                      {!heading && (
                        <button
                          type="button"
                          onClick={() => setRuleOpen(open ? null : f.field_key)}
                          aria-expanded={open}
                          title="Smart settings"
                          aria-label={`Smart settings for ${f.label}`}
                          className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium transition-colors ${open || smart.length ? "bg-primary/10 text-primary" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="px-2 pb-2">
                        <FormRuleEditor
                          fieldKey={f.field_key}
                          fieldLabel={f.label}
                          rule={rule}
                          earlier={earlierThan(f.field_key)}
                          sources={sources}
                          onChange={(r) => setRule(f.field_key, r)}
                        />
                      </div>
                    )}
                  </div>
                )
              }}
            />

            {listed.some((f) => !shown.has(f.field_key)) && (
              <div className="flex flex-col gap-1 border-t border-slate-100 pt-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Not asked</p>
                {listed.filter((f) => !shown.has(f.field_key)).map((f) => (
                  <label key={f.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50">
                    <input type="checkbox" checked={false} onChange={() => toggleField(f.field_key)} aria-label={`Ask “${f.label}”`}
                      className="h-4 w-4 accent-[var(--primary)]" />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              Tip: fill answers in advance through the link — add <code className="rounded bg-slate-100 px-1">?field_key=value</code>.
              In the thank-you message, <code className="rounded bg-slate-100 px-1">{"{{field_key}}"}</code> repeats an answer.
            </p>
          </PanelSection>

          <PanelSection title="When it stops">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-slate-600">
                Closes on
                <input
                  id="form-closes"
                  type="datetime-local"
                  value={toLocalInput(config.closes_at)}
                  onChange={(e) =>
                    patch({ closes_at: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-slate-600">
                Most answers
                <input
                  id="form-max"
                  type="number"
                  min={1}
                  value={config.max_responses ?? ""}
                  onChange={(e) => patch({ max_responses: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                  placeholder="No limit"
                  className={FIELD}
                />
              </label>
            </div>
          </PanelSection>

          <PanelSection title="Privacy">
            <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
              <span>
                Ask for consent
                <span className="block text-[11.5px] text-slate-400">
                  A tick box they must tick — what India&apos;s DPDP Act expects before storing personal details.
                </span>
              </span>
              <Switch
                checked={!!config.consent_text}
                onCheckedChange={(v) => patch({ consent_text: v ? config.consent_text || DEFAULT_CONSENT : null })}
              />
            </label>
            {config.consent_text && (
              <textarea
                id="form-consent"
                value={config.consent_text}
                onChange={(e) => patch({ consent_text: e.target.value })}
                maxLength={500}
                rows={2}
                className={`${FIELD} h-auto py-2`}
                aria-label="Consent text"
              />
            )}
            <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
              <span>
                Personal links only
                <span className="block text-[11.5px] text-slate-400">Only customers you send a personal link to can answer.</span>
              </span>
              <Switch checked={config.personal_only} onCheckedChange={(v) => patch({ personal_only: v })} />
            </label>
            <label className="flex items-start justify-between gap-3 text-[13px] text-slate-700">
              <span>
                One answer per customer
                <span className="block text-[11.5px] text-slate-400">Checked for personal links, by customer.</span>
              </span>
              <Switch checked={config.one_per_person} onCheckedChange={(v) => patch({ one_per_person: v })} />
            </label>
          </PanelSection>

          {config.enabled && path && (
            <PanelSection
              title="Personal link for a customer"
              hint="Their answer is saved under their name and number, and their number is filled in for them."
            >
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  id="form-contact-search"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  placeholder="Search a contact by name or number"
                  className={`${FIELD} pl-8`}
                  autoComplete="off"
                />
                {hits.length > 0 && (
                  <div className="absolute left-0 right-0 top-10 z-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                    {hits.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => makePersonal(c)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50"
                      >
                        <UserRound className="h-3.5 w-3.5 text-slate-400" />
                        <span className="flex-1 truncate">{c.name || "No name"}</span>
                        <span className="font-mono text-[11.5px] text-slate-400">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {personal && (
                <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
                  <p className="text-[12px] text-slate-600">
                    For <span className="font-medium text-slate-800">{personal.contact.name || personal.contact.phone}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      id="form-personal-link"
                      readOnly
                      value={personal.url}
                      onFocus={(e) => e.currentTarget.select()}
                      className={`${FIELD} font-mono text-[11.5px]`}
                    />
                    <button
                      type="button"
                      onClick={() => copy(personal.url)}
                      title="Copy link"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <a
                    href={`https://wa.me/${personal.contact.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`${config.title || tableName}: ${personal.url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline"
                  >
                    <Send className="h-3.5 w-3.5" /> Send it to them on WhatsApp
                  </a>
                </div>
              )}
            </PanelSection>
          )}

          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-[12px] leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            The form only adds rows — it never shows anyone else&apos;s answers. Bots are kept out by a hidden trap
            field, a minimum fill time and a limit per connection, with no third-party CAPTCHA.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmNewLink}
        title="Replace the link?"
        description="The current link and its QR code stop working at once, including personal links already sent. Use this if the link was shared somewhere it should not be."
        confirmLabel="Replace"
        onConfirm={newLink}
        onCancel={() => setConfirmNewLink(false)}
      />
    </SidePanel>
  )
}
