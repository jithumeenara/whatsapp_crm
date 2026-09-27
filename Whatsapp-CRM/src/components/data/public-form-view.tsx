"use client"

/**
 * The public "Get Data" form as a customer sees it.
 *
 * Built to be quicker and kinder than a generic form tool: it speaks
 * Malayalam or English, shows how far along you are, checks each answer
 * as you leave it and says what is wrong in plain words, keeps your
 * answers if the page reloads, turns short lists into tap-sized choices,
 * fills in what the business already knows from a personal link, and
 * ends with a reference number to quote.
 *
 * Nothing here is trusted — the server checks every value again
 * (src/app/api/forms/[token]/route.ts). Answers kept for a reload live
 * in this tab's sessionStorage only, and are wiped on sending.
 */

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, Clock, Copy, Loader2, Lock, RotateCcw, ShieldCheck, Users,
} from "lucide-react"
import type { PublicFormField } from "@/lib/data-store/public-form"
import { FORM_STRINGS, type FormLang, type FormStrings } from "./form-strings"

interface Props {
  token: string
  ticket: string
  personal: string | null
  greeting: string | null
  businessName: string | null
  title: string
  intro: string | null
  fields: PublicFormField[]
  consentText: string | null
  closedReason: "off" | "closed" | "full" | null
  personalOnlyBlocked: boolean
  prefill: Record<string, string>
  /** Milliseconds until the form closes, measured on the server. */
  closesInMs: number | null
  spotsLeft: number | null
  allowAnother: boolean
}

type Value = string | boolean
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE = /^[+]?[\d\s\-()]{7,20}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** Short lists read better as buttons than inside a dropdown. */
const MAX_CARD_OPTIONS = 6

const noop = () => () => {}

function isDisplay(f: PublicFormField) {
  return f.type === "section_header"
}

function autoComplete(f: PublicFormField): string {
  const words = `${f.key} ${f.label}`.toLowerCase()
  if (f.type === "email") return "email"
  if (f.type === "phone") return "tel"
  if (f.type === "date" && /birth|dob/.test(words)) return "bday"
  if (/pin\s*code|pincode|postal|zip/.test(words)) return "postal-code"
  if (/address/.test(words)) return "street-address"
  if (/\bcity\b|\btown\b/.test(words)) return "address-level2"
  if (/\bstate\b/.test(words)) return "address-level1"
  if (/country/.test(words)) return "country-name"
  if (/company|organi[sz]ation|institution/.test(words)) return "organization"
  if (/\bname\b|full_name|fullname/.test(words)) return "name"
  return "off"
}

function inputType(type: string): string {
  switch (type) {
    case "number": return "text"
    case "date": return "date"
    case "time": return "time"
    case "email": return "email"
    case "phone": return "tel"
    case "url": return "url"
    default: return "text"
  }
}

function checkAnswer(f: PublicFormField, v: Value | undefined, t: FormStrings): string | null {
  if (isDisplay(f)) return null
  if (f.type === "boolean") return f.required && v !== true ? t.errTick : null
  const s = typeof v === "string" ? v.trim() : ""
  if (!s) return f.required ? t.errRequired : null
  if (f.type === "email" && !EMAIL.test(s)) return t.errEmail
  if (f.type === "phone" && !PHONE.test(s)) return t.errPhone
  if (f.type === "time" && !TIME.test(s)) return t.errTime
  if (f.type === "url") {
    try {
      const u = new URL(s)
      if (u.protocol !== "http:" && u.protocol !== "https:") return t.errUrl
    } catch {
      return t.errUrl
    }
  }
  if (f.type === "number") {
    const n = Number(s.replace(/,/g, ""))
    if (!Number.isFinite(n)) return t.errNumber
    if (f.min !== undefined && n < f.min) return t.errMin(f.min)
    if (f.max !== undefined && n > f.max) return t.errMax(f.max)
    return null
  }
  const length = [...s].length
  if (f.minLength !== undefined && length < f.minLength) return t.errMinLength(f.minLength)
  if (f.maxLength !== undefined && length > f.maxLength) return t.errMaxLength(f.maxLength)
  return null
}

function relativeTime(ms: number, lang: FormLang): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" })
  const hours = ms / 3_600_000
  if (hours < 1) return rtf.format(Math.max(1, Math.round(ms / 60_000)), "minute")
  if (hours < 48) return rtf.format(Math.round(hours), "hour")
  return rtf.format(Math.round(hours / 24), "day")
}

function readDraft(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeDraft(key: string, values: Record<string, Value> | null) {
  try {
    if (values) sessionStorage.setItem(key, JSON.stringify(values))
    else sessionStorage.removeItem(key)
  } catch {
    // Private mode or storage off: the form works, it just forgets.
  }
}

function scrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  } catch {
    return "auto"
  }
}

export function PublicFormView(props: Props) {
  const { fields } = props
  const draftKey = `form-draft:${props.token}:${props.personal ? props.personal.slice(0, 12) : "public"}`

  // Read after hydration without a mismatch: the server has neither.
  const detected = useSyncExternalStore<FormLang>(
    noop,
    () => ((navigator.language || "en").toLowerCase().startsWith("ml") ? "ml" : "en"),
    () => "en",
  )
  const savedDraft = useSyncExternalStore(noop, () => readDraft(draftKey), () => null)

  const [chosenLang, setChosenLang] = useState<FormLang | null>(null)
  const lang = chosenLang ?? detected
  const t = FORM_STRINGS[lang]

  const [values, setValues] = useState<Record<string, Value>>(() => ({ ...props.prefill }))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [attempted, setAttempted] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [draftDecided, setDraftDecided] = useState(false)
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ message: string | null; reference: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  const answerable = useMemo(() => fields.filter((f) => !isDisplay(f)), [fields])
  const answered = answerable.filter((f) => {
    const v = values[f.key]
    return f.type === "boolean" ? v === true : typeof v === "string" && v.trim() !== ""
  }).length
  const progress = answerable.length ? Math.round((answered / answerable.length) * 100) : 0
  const minutes = Math.max(1, Math.round(answerable.length * 0.3))

  const errors: Record<string, string> = {}
  for (const f of answerable) {
    const problem = checkAnswer(f, values[f.key], t)
    if (problem) errors[f.key] = problem
  }
  const showError = (key: string) => (attempted || touched.has(key)) && errors[key]

  function set(key: string, value: Value) {
    setValues((v) => {
      const next = { ...v, [key]: value }
      writeDraft(draftKey, next)
      return next
    })
    setDirty(true)
    setError(null)
  }

  function touch(key: string) {
    setTouched((s) => (s.has(key) ? s : new Set(s).add(key)))
  }

  function restoreDraft() {
    setDraftDecided(true)
    try {
      const parsed = JSON.parse(savedDraft ?? "{}") as Record<string, unknown>
      const keys = new Set(answerable.map((f) => f.key))
      const restored: Record<string, Value> = { ...props.prefill }
      for (const [k, v] of Object.entries(parsed)) {
        if (keys.has(k) && (typeof v === "string" || typeof v === "boolean")) restored[k] = v
      }
      setValues(restored)
    } catch {
      // A draft that cannot be read is simply not offered again.
    }
  }

  function startOver() {
    setDraftDecided(true)
    writeDraft(draftKey, null)
    setValues({ ...props.prefill })
  }

  function focusQuestion(key: string) {
    const el = document.getElementById(`q-${key}`)
    el?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })
    el?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    setError(null)
    const first = answerable.find((f) => errors[f.key])
    if (first) {
      setError(t.errCheck)
      focusQuestion(first.key)
      return
    }
    if (props.consentText && !consent) {
      setError(t.errConsent)
      document.getElementById("f-consent")?.focus()
      return
    }
    setSending(true)
    try {
      const payload: Record<string, Value> = {}
      for (const f of answerable) {
        const v = values[f.key]
        if (f.type === "boolean") payload[f.key] = v === true
        else if (typeof v === "string" && v.trim() !== "") payload[f.key] = v.trim()
      }
      const res = await fetch(`/api/forms/${encodeURIComponent(props.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: payload,
          ticket: props.ticket,
          consent,
          website: honeypot,
          ...(props.personal ? { c: props.personal } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string | null
        reference?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        setError(res.status === 429 ? t.errTooMany : data.error || t.errGeneric)
        return
      }
      writeDraft(draftKey, null)
      setDone({ message: data.message ?? null, reference: data.reference ?? null })
      window.scrollTo({ top: 0, behavior: scrollBehavior() })
    } catch {
      setError(t.errNetwork)
    } finally {
      setSending(false)
    }
  }

  function another() {
    setDone(null)
    setValues({ ...props.prefill })
    setTouched(new Set())
    setAttempted(false)
    setConsent(false)
    setCopied(false)
  }

  async function copyReference(ref: string) {
    try {
      await navigator.clipboard.writeText(ref)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  let blocked: string | null = null
  if (props.closedReason === "full") blocked = t.full
  else if (props.closedReason) blocked = t.closed
  else if (props.personalOnlyBlocked) blocked = t.personalOnly

  const showDraftBanner = !!savedDraft && !dirty && !draftDecided && !done && !blocked
  const business = props.businessName || t.thisBusiness
  const numberOf = new Map(answerable.map((f, i) => [f.key, i + 1]))

  return (
    <div lang={lang} className="relative">
      {/* A quiet wash of the brand colour behind the top of the page. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-primary/15 to-transparent" />

      {!done && !blocked && (
        <div className="sticky top-0 z-20 h-1 w-full bg-slate-200/70" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t.answered(answered, answerable.length)}>
          <div className="h-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      )}

      <main className="relative mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:pt-10">
        <header className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[16px] font-bold text-primary shadow-sm ring-1 ring-slate-200">
            {(props.businessName || props.title).trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-800">
            {props.businessName}
          </span>
          <div role="group" aria-label={t.language} className="flex shrink-0 rounded-full bg-white p-0.5 text-[12px] font-medium shadow-sm ring-1 ring-slate-200">
            {(["en", "ml"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setChosenLang(l)}
                aria-pressed={lang === l}
                className={`rounded-full px-3 py-1 transition-colors ${lang === l ? "bg-primary text-primary-foreground" : "text-slate-600 hover:text-slate-900"}`}
              >
                {l === "en" ? "English" : "മലയാളം"}
              </button>
            ))}
          </div>
        </header>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 pb-5 pt-6 sm:px-8">
            <h1 className="text-balance text-[24px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[28px]">
              {props.title}
            </h1>
            {props.greeting && !done && <p className="mt-2 text-[15px] text-slate-600">{t.hello(props.greeting)}</p>}
            {props.intro && !done && (
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-600">{props.intro}</p>
            )}
            {!done && !blocked && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                  <Clock className="h-3.5 w-3.5" /> {t.takes(minutes)}
                </span>
                {props.closesInMs !== null && props.closesInMs > 0 && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${props.closesInMs < 48 * 3_600_000 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                    <CalendarClock className="h-3.5 w-3.5" /> {t.closes(relativeTime(props.closesInMs, lang))}
                  </span>
                )}
                {props.spotsLeft !== null && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${props.spotsLeft <= 10 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                    <Users className="h-3.5 w-3.5" /> {t.placesLeft(props.spotsLeft)}
                  </span>
                )}
                <span className="ml-auto text-slate-500 tabular-nums">{t.answered(answered, answerable.length)}</span>
              </div>
            )}
          </div>

          <div className="px-5 py-6 sm:px-8">
            {done ? (
              <div className="flex flex-col items-center py-6 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
                  <CheckCircle2 className="h-9 w-9 text-emerald-600" />
                </span>
                <h2 className="mt-4 text-[20px] font-bold text-slate-900">{t.submitted}</h2>
                <p className="mt-1.5 max-w-md whitespace-pre-line text-[15px] leading-relaxed text-slate-600">
                  {done.message || t.thanks}
                </p>
                {done.reference && (
                  <div className="mt-5 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
                    <span className="text-[12px] text-slate-500">{t.reference}</span>
                    <span className="font-mono text-[16px] font-semibold tracking-wider text-slate-900">{done.reference}</span>
                    <button
                      type="button"
                      onClick={() => copyReference(done.reference!)}
                      aria-label={t.reference}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                {copied && <span className="mt-1 text-[12px] text-emerald-700">{t.copied}</span>}
                {props.allowAnother && (
                  <button
                    type="button"
                    onClick={another}
                    className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {t.another}
                  </button>
                )}
              </div>
            ) : blocked ? (
              <div className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-5 text-[15px] text-slate-700">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                {blocked}
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                {showDraftBanner && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-primary/5 px-4 py-3 text-[13.5px] text-slate-700 ring-1 ring-primary/20">
                    <span className="flex-1">{t.draftFound}</span>
                    <button type="button" onClick={restoreDraft} className="font-semibold text-primary hover:underline">
                      {t.restore}
                    </button>
                    <button type="button" onClick={startOver} className="text-slate-500 hover:text-slate-800">
                      {t.startOver}
                    </button>
                  </div>
                )}

                {fields.map((f) => {
                  if (isDisplay(f)) {
                    return (
                      <div key={f.key} className="mt-3 border-t border-slate-100 pt-5 first:mt-0 first:border-0 first:pt-0">
                        <h2 className="text-[17px] font-semibold text-slate-900">{f.label}</h2>
                        {f.help && <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-500">{f.help}</p>}
                      </div>
                    )
                  }
                  const id = `f-${f.key}`
                  const value = values[f.key]
                  const err = showError(f.key)
                  const describedBy = [f.help ? `${id}-help` : null, err ? `${id}-err` : null].filter(Boolean).join(" ") || undefined
                  const options = f.options ?? []
                  const asCards = (f.type === "radio" || f.type === "select") && options.length > 0 && (f.type === "radio" || options.length <= MAX_CARD_OPTIONS)
                  const box = `rounded-2xl border p-4 transition-colors sm:p-5 ${err ? "border-rose-300 bg-rose-50/40" : "border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"}`
                  const control = `w-full rounded-xl border bg-white px-3.5 py-3 text-[16px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary ${err ? "border-rose-300" : "border-slate-300"}`

                  return (
                    <div key={f.key} id={`q-${f.key}`} className={box}>
                      {f.type === "boolean" ? (
                        <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
                          <input
                            id={id}
                            type="checkbox"
                            checked={value === true}
                            onChange={(e) => {
                              set(f.key, e.target.checked)
                              touch(f.key)
                            }}
                            aria-invalid={!!err}
                            aria-describedby={describedBy}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--primary)]"
                          />
                          <span className="text-[15px] font-medium text-slate-800">
                            {f.label}
                            {f.required && <span className="ml-1 text-rose-500" aria-label={t.required}>*</span>}
                          </span>
                        </label>
                      ) : (
                        <>
                          <label htmlFor={asCards ? undefined : id} id={`${id}-label`} className="flex items-baseline gap-2 text-[15px] font-medium text-slate-800">
                            <span aria-hidden="true" className="text-[12px] font-semibold tabular-nums text-slate-400">{numberOf.get(f.key)}</span>
                            <span>
                              {f.label}
                              {f.required && <span className="ml-1 text-rose-500" aria-label={t.required}>*</span>}
                            </span>
                          </label>
                          {f.help && (
                            <p id={`${id}-help`} className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-500">
                              {f.help}
                            </p>
                          )}
                          <div className="mt-3">
                            {asCards ? (
                              <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="grid gap-2 sm:grid-cols-2">
                                {options.map((o) => (
                                  <label
                                    key={o}
                                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-slate-800 transition-colors hover:border-slate-300 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/15"
                                  >
                                    <input
                                      type="radio"
                                      name={f.key}
                                      value={o}
                                      checked={value === o}
                                      onChange={() => {
                                        set(f.key, o)
                                        touch(f.key)
                                      }}
                                      className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                                    />
                                    <span className="min-w-0 break-words">{o}</span>
                                  </label>
                                ))}
                              </div>
                            ) : f.type === "select" && options.length > 0 ? (
                              <select
                                id={id}
                                value={typeof value === "string" ? value : ""}
                                onChange={(e) => {
                                  set(f.key, e.target.value)
                                  touch(f.key)
                                }}
                                aria-invalid={!!err}
                                aria-describedby={describedBy}
                                className={control}
                              >
                                <option value="">{t.choose}</option>
                                {options.map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            ) : f.type === "textarea" ? (
                              <>
                                <textarea
                                  id={id}
                                  rows={4}
                                  maxLength={f.maxLength ?? 5000}
                                  placeholder={f.placeholder}
                                  value={typeof value === "string" ? value : ""}
                                  onChange={(e) => set(f.key, e.target.value)}
                                  onBlur={() => touch(f.key)}
                                  aria-invalid={!!err}
                                  aria-describedby={describedBy}
                                  className={`${control} min-h-28 resize-y [field-sizing:content]`}
                                />
                                <p className="mt-1 text-right text-[11.5px] tabular-nums text-slate-400">
                                  {typeof value === "string" ? [...value].length : 0}/{f.maxLength ?? 5000}
                                </p>
                              </>
                            ) : (
                              <input
                                id={id}
                                type={inputType(f.type)}
                                inputMode={f.type === "phone" ? "tel" : f.type === "number" ? "decimal" : f.type === "email" ? "email" : undefined}
                                autoComplete={autoComplete(f)}
                                maxLength={f.maxLength ?? 2000}
                                placeholder={f.placeholder ?? (f.type === "phone" ? "+91 98765 43210" : undefined)}
                                value={typeof value === "string" ? value : ""}
                                onChange={(e) => set(f.key, e.target.value)}
                                onBlur={() => touch(f.key)}
                                aria-invalid={!!err}
                                aria-describedby={describedBy}
                                className={control}
                              />
                            )}
                          </div>
                        </>
                      )}
                      {err && (
                        <p id={`${id}-err`} className="mt-2 flex items-center gap-1.5 text-[13px] text-rose-700">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
                        </p>
                      )}
                    </div>
                  )
                })}

                {/* A field no person sees or reaches with Tab. Bots fill it in. */}
                <div aria-hidden="true" inert className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="f-website">Website</label>
                  <input id="f-website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </div>

                {props.consentText && (
                  <label
                    htmlFor="f-consent"
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-[14px] leading-relaxed text-slate-700 ring-1 ${attempted && !consent ? "bg-rose-50/60 ring-rose-300" : "bg-slate-50 ring-slate-200"}`}
                  >
                    <input
                      id="f-consent"
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => {
                        setConsent(e.target.checked)
                        setError(null)
                      }}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
                    />
                    <span>{props.consentText}</span>
                  </label>
                )}

                {error && (
                  <p role="alert" className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-[14px] text-rose-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={sending}
                  className="mt-1 flex h-13 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.99] disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {sending ? t.sending : t.submit}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {t.secure(business)}
        </p>
      </main>
    </div>
  )
}
