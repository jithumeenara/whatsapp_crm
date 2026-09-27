"use client"

/**
 * The public "Get Data" form as a customer sees it.
 *
 * Built to be quicker and kinder than a generic form tool:
 *  • the business's own header — logo, name, tagline, colour — and its
 *    contact details at the foot;
 *  • Malayalam or English for everything around the questions;
 *  • smart questions: a dropdown narrows to what fits an earlier answer,
 *    picking a row fills the questions that follow from it (locked when
 *    the business says so), and a question can appear only when it
 *    applies;
 *  • long lists you can type into; short ones as tap-sized cards;
 *  • progress, answers checked as you leave them, answers kept if the
 *    page reloads, answers carried in the link, a reference number at
 *    the end with the answers repeated in the thank-you.
 *
 * Nothing here is trusted — the server repeats every check and every
 * rule (src/app/api/forms/[token]/route.ts); a locked answer is always
 * recomputed there. Answers kept for a reload live in this tab's
 * sessionStorage only, and are wiped on sending.
 */

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, Clock, Copy, Globe, Loader2, Lock, Mail, MapPin, Phone,
  RotateCcw, ShieldCheck, Users,
} from "lucide-react"
import type { PublicFormField } from "@/lib/data-store/public-form"
import {
  fillValue, isShown, optionsFor, pipeAnswers,
  type Answers, type FormLookups, type FormRules,
} from "@/lib/data-store/form-logic"
import type { PublicFormBrand } from "@/lib/data-store/public-form-server"
import { FORM_STRINGS, type FormLang, type FormStrings } from "./form-strings"
import { FormCombobox } from "./form-combobox"

interface Props {
  token: string
  ticket: string
  personal: string | null
  greeting: string | null
  businessName: string | null
  brand: PublicFormBrand
  rules: FormRules
  lookups: FormLookups
  successMessage: string | null
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
/** Up to this many choices show as cards; more become a searchable list. */
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
  if (/company|organi[sz]ation|institution|society/.test(words)) return "organization"
  if (/\bname\b|full_name|fullname/.test(words)) return "name"
  return "off"
}

function inputType(type: string): string {
  switch (type) {
    case "date": return "date"
    case "time": return "time"
    case "email": return "email"
    case "phone": return "tel"
    case "url": return "url"
    default: return "text"
  }
}

function checkAnswer(f: PublicFormField, v: Value | undefined, t: FormStrings): string | null {
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
  const { fields, rules, lookups, brand } = props
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
  const [done, setDone] = useState<{ message: string; reference: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  const answerable = useMemo(() => fields.filter((f) => !isDisplay(f)), [fields])
  const labelOf = useMemo(() => new Map(fields.map((f) => [f.key, f.label])), [fields])

  // The answers as they stand, with every locked question filled from
  // the table — what progress, conditions and options are worked from.
  const answers: Answers = { ...values }
  for (const f of answerable) {
    if (rules[f.key]?.fill?.locked) answers[f.key] = fillValue(f.key, rules, lookups, answers) ?? ""
  }
  const locked = (f: PublicFormField) => !!rules[f.key]?.fill?.locked
  const shown = (f: PublicFormField) => isDisplay(f) || isShown(f.key, rules, answers)
  const optionsOf = (f: PublicFormField) => optionsFor(f.key, rules, lookups, answers) ?? f.options ?? []
  const waitingOn = (f: PublicFormField) => {
    const dep = rules[f.key]?.filter?.depends_on
    return dep && !String(answers[dep] ?? "").trim() ? dep : null
  }

  const asked = answerable.filter((f) => shown(f) && !locked(f))
  const answered = asked.filter((f) => {
    const v = answers[f.key]
    return f.type === "boolean" ? v === true : typeof v === "string" && v.trim() !== ""
  }).length
  const progress = asked.length ? Math.round((answered / asked.length) * 100) : 0
  const minutes = Math.max(1, Math.round(asked.length * 0.3))

  const errors: Record<string, string> = {}
  for (const f of asked) {
    const problem = checkAnswer(f, answers[f.key], t)
    if (problem) errors[f.key] = problem
  }
  const showError = (key: string) => (attempted || touched.has(key)) && errors[key]

  /** Sets an answer and settles everything that hangs off it: a
   *  narrowed dropdown whose answer no longer fits is cleared, and an
   *  unlocked filled question takes the new row's value. */
  function set(key: string, value: Value) {
    setValues((v) => {
      const next: Record<string, Value> = { ...v, [key]: value }
      for (let pass = 0; pass < 4; pass++) {
        let changed = false
        const current: Answers = { ...next }
        for (const f of answerable) {
          const rule = rules[f.key]
          if (!rule) continue
          if (rule.filter && typeof next[f.key] === "string" && next[f.key]) {
            const allowed = optionsFor(f.key, rules, lookups, current)
            if (allowed && !allowed.some((o) => o.toLowerCase() === String(next[f.key]).toLowerCase())) {
              next[f.key] = ""
              changed = true
            }
          }
          if (rule.fill && !rule.fill.locked && rule.fill.from_field === key) {
            const filled = fillValue(f.key, rules, lookups, current)
            if (filled !== null && next[f.key] !== filled) {
              next[f.key] = filled
              changed = true
            }
          }
        }
        if (!changed) break
      }
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
    el?.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    setError(null)
    const first = asked.find((f) => errors[f.key])
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
      // Only what the person answered: hidden questions are left out,
      // and locked ones the server works out for itself.
      const payload: Record<string, Value> = {}
      for (const f of asked) {
        const v = answers[f.key]
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
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reference?: string; error?: string }
      if (!res.ok || !data.ok) {
        setError(res.status === 429 ? t.errTooMany : data.error || t.errGeneric)
        return
      }
      writeDraft(draftKey, null)
      setDone({ message: pipeAnswers(props.successMessage || t.thanks, answers), reference: data.reference ?? null })
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
  const business = brand.name || props.businessName || t.thisBusiness
  const numberOf = new Map(asked.map((f, i) => [f.key, i + 1]))
  const brandStyle = { "--primary": brand.color, "--primary-foreground": "#ffffff" } as React.CSSProperties
  const languageSwitch = (
    <div role="group" aria-label={t.language} className="flex rounded-full bg-white/15 p-0.5 text-[12px] font-medium ring-1 ring-white/25 backdrop-blur">
      {(["en", "ml"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setChosenLang(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-3 py-1 transition-colors ${lang === l ? "bg-white text-slate-900" : "text-white/90 hover:text-white"}`}
        >
          {l === "en" ? "English" : "മലയാളം"}
        </button>
      ))}
    </div>
  )

  return (
    <div lang={lang} style={brandStyle} className="relative min-h-dvh bg-slate-50">
      {!done && !blocked && (
        <div className="sticky top-0 z-20 h-1 w-full bg-white/60" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t.answered(answered, asked.length)}>
          <div className="h-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* ── Business header ────────────────────────────────────────── */}
      <header className="relative overflow-hidden bg-primary text-white">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,255,255,0.22),transparent_55%),linear-gradient(180deg,transparent,rgba(0,0,0,0.18))]" />
        <div className="relative mx-auto w-full max-w-2xl px-4 pb-20 pt-4 sm:pt-8">
          {/* On a phone the language switch gets its own row, so the
              business name is never squeezed. */}
          <div className="mb-3 flex justify-end sm:hidden">{languageSwitch}</div>
          <div className="flex items-start gap-3.5 sm:gap-4">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-sm sm:h-16 sm:w-16" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/95 text-[22px] font-bold text-primary shadow-sm sm:h-16 sm:w-16">
                {business.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-balance text-[18px] font-bold leading-snug sm:text-[20px]">{business}</p>
              {brand.tagline && <p className="mt-0.5 text-[13px] leading-snug text-white/85 sm:text-[14px]">{brand.tagline}</p>}
            </div>
            <div className="hidden shrink-0 sm:block">{languageSwitch}</div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-14 w-full max-w-2xl px-4 pb-10">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <div className="border-b border-slate-100 px-5 pb-5 pt-6 sm:px-8">
            <h1 className="text-balance text-[24px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[28px]">{props.title}</h1>
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
                <span className="ml-auto tabular-nums text-slate-500">{t.answered(answered, asked.length)}</span>
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
                <p className="mt-1.5 max-w-md whitespace-pre-line text-[15px] leading-relaxed text-slate-600">{done.message}</p>
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
                  <button type="button" onClick={another} className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline">
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
                    <button type="button" onClick={restoreDraft} className="font-semibold text-primary hover:underline">{t.restore}</button>
                    <button type="button" onClick={startOver} className="text-slate-500 hover:text-slate-800">{t.startOver}</button>
                  </div>
                )}

                {fields.filter(shown).map((f) => {
                  if (isDisplay(f)) {
                    return (
                      <div key={f.key} className="mt-3 border-t border-slate-100 pt-5 first:mt-0 first:border-0 first:pt-0">
                        <h2 className="text-[17px] font-semibold text-slate-900">{f.label}</h2>
                        {f.help && <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-500">{f.help}</p>}
                      </div>
                    )
                  }
                  return (
                    <Question
                      key={f.key}
                      field={f}
                      number={numberOf.get(f.key)}
                      value={answers[f.key]}
                      options={optionsOf(f)}
                      locked={locked(f)}
                      waitingOn={waitingOn(f) ? labelOf.get(waitingOn(f)!) ?? "" : null}
                      error={showError(f.key) || null}
                      t={t}
                      onChange={(v) => set(f.key, v)}
                      onTouch={() => touch(f.key)}
                    />
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
                  className="mt-1 flex h-13 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.99] disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {sending ? t.sending : t.submit}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* ── Contact and trust ───────────────────────────────────── */}
        {brand.contact && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">{t.contact} · {business}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-slate-700">
              {brand.contact.phone && (
                <a href={`tel:${brand.contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Phone className="h-4 w-4 text-slate-400" /> {brand.contact.phone}
                </a>
              )}
              {brand.contact.email && (
                <a href={`mailto:${brand.contact.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
                  <Mail className="h-4 w-4 shrink-0 text-slate-400" /> {brand.contact.email}
                </a>
              )}
              {brand.contact.website && (
                <a href={brand.contact.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
                  <Globe className="h-4 w-4 shrink-0 text-slate-400" /> {brand.contact.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
              {brand.contact.address && (
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {brand.contact.address}
                </span>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {t.secure(business)}
        </p>
      </main>
    </div>
  )
}

/** One question, in whichever shape suits it. */
function Question({
  field: f, number, value, options, locked, waitingOn, error, t, onChange, onTouch,
}: {
  field: PublicFormField
  number: number | undefined
  value: string | boolean | undefined
  options: string[]
  locked: boolean
  waitingOn: string | null
  error: string | null
  t: FormStrings
  onChange(v: string | boolean): void
  onTouch(): void
}) {
  const id = `f-${f.key}`
  const text = typeof value === "string" ? value : ""
  const describedBy = [f.help ? `${id}-help` : null, error ? `${id}-err` : null, locked ? `${id}-lock` : null].filter(Boolean).join(" ") || undefined
  const isChoice = (f.type === "radio" || f.type === "select") && options.length > 0
  const asCards = isChoice && options.length <= MAX_CARD_OPTIONS
  const box = `rounded-2xl border p-4 transition-colors sm:p-5 ${error ? "border-rose-300 bg-rose-50/40" : locked ? "border-slate-200 bg-slate-50/70" : "border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"}`
  const control = `w-full rounded-xl border bg-white px-3.5 py-3 text-[16px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary ${error ? "border-rose-300" : "border-slate-300"}`

  const label = (
    <span>
      {f.label}
      {f.required && !locked && <span className="ml-1 text-rose-500" aria-label={t.required}>*</span>}
    </span>
  )

  if (f.type === "boolean") {
    return (
      <div id={`q-${f.key}`} className={box}>
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => { onChange(e.target.checked); onTouch() }}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--primary)]"
          />
          <span className="text-[15px] font-medium text-slate-800">{label}</span>
        </label>
        {error && <ErrorLine id={`${id}-err`} text={error} />}
      </div>
    )
  }

  return (
    <div id={`q-${f.key}`} className={box}>
      <label htmlFor={asCards || locked ? undefined : id} id={`${id}-label`} className="flex items-baseline gap-2 text-[15px] font-medium text-slate-800">
        {number !== undefined && !locked && <span aria-hidden="true" className="text-[12px] font-semibold tabular-nums text-slate-400">{number}</span>}
        {locked && <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 self-center text-slate-400" />}
        {label}
      </label>
      {f.help && <p id={`${id}-help`} className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-500">{f.help}</p>}

      <div className="mt-3">
        {locked ? (
          <>
            <div
              id={id}
              role="textbox"
              aria-readonly="true"
              aria-labelledby={`${id}-label`}
              aria-describedby={describedBy}
              className="flex min-h-12 items-center rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-3 text-[16px] text-slate-900"
            >
              {text || <span className="text-slate-400">—</span>}
            </div>
            <p id={`${id}-lock`} className="mt-1.5 text-[12px] text-slate-500">{t.filledForYou}</p>
          </>
        ) : waitingOn ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-[14px] text-slate-500">{t.chooseFirst(waitingOn)}</div>
        ) : asCards ? (
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
                  checked={text === o}
                  onChange={() => { onChange(o); onTouch() }}
                  className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 break-words">{o}</span>
              </label>
            ))}
          </div>
        ) : isChoice ? (
          <FormCombobox
            id={id}
            value={text}
            options={options}
            onChange={(v) => onChange(v)}
            onBlur={onTouch}
            placeholder={`${t.choose} · ${t.optionsCount(options.length)}`}
            searchPlaceholder={t.searchOptions}
            noMatch={t.noMatch}
            invalid={!!error}
            describedBy={describedBy}
          />
        ) : f.type === "textarea" ? (
          <>
            <textarea
              id={id}
              rows={4}
              maxLength={f.maxLength ?? 5000}
              placeholder={f.placeholder}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onTouch}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              className={`${control} min-h-28 resize-y [field-sizing:content]`}
            />
            <p className="mt-1 text-right text-[11.5px] tabular-nums text-slate-400">{[...text].length}/{f.maxLength ?? 5000}</p>
          </>
        ) : (
          <input
            id={id}
            type={inputType(f.type)}
            inputMode={f.type === "phone" ? "tel" : f.type === "number" ? "decimal" : f.type === "email" ? "email" : undefined}
            autoComplete={autoComplete(f)}
            maxLength={f.maxLength ?? 2000}
            placeholder={f.placeholder ?? (f.type === "phone" ? "+91 98765 43210" : undefined)}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onTouch}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={control}
          />
        )}
      </div>
      {error && <ErrorLine id={`${id}-err`} text={error} />}
    </div>
  )
}

function ErrorLine({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="mt-2 flex items-center gap-1.5 text-[13px] text-rose-700">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {text}
    </p>
  )
}
