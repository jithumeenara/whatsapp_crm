"use client"

/**
 * The page a person opens from their private link: their own details from
 * the business's list, to confirm or correct. Phone-first, one column,
 * large targets; every language the business can choose, right to left
 * for Arabic. Nothing here is trusted — the server checks the link, the
 * columns that may change and the values again. Laid out like the shared
 * public form, so a person who filled that in sees the same business page.
 */

import { useEffect, useState } from "react"
import { AlertCircle, CalendarClock, CheckCircle2, ChevronDown, Globe, Loader2, Lock, Mail, MapPin, Pencil, Phone, RotateCcw, ShieldCheck } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { langInfo, isFormLang } from "@/lib/data-store/form-i18n"
import type { ViewItem } from "@/lib/verify/sheet-verify"
import type { HelpButtons, VerifyBrand } from "@/lib/verify/verify-brand"
import { verifyStrings, type VerifyStrings } from "@/lib/verify/verify-strings"

type Props =
  | { mode: "message"; lang: string; business: string; brand: VerifyBrand; help: HelpButtons; message: string; retry?: boolean }
  | {
      mode: "form"
      token: string
      lang: string
      business: string
      brand: VerifyBrand
      help: HelpButtons
      intro: string | null
      deadline: string
      items: ViewItem[]
      done: boolean
    }

function BusinessHeader({ business, brand }: Readonly<{ business: string; brand: VerifyBrand }>) {
  return (
    <header className="relative overflow-hidden bg-primary text-white">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,255,255,0.22),transparent_55%),linear-gradient(180deg,transparent,rgba(0,0,0,0.18))]" />
      <div className="relative mx-auto flex w-full max-w-2xl items-start gap-3.5 px-4 pb-20 pt-5 sm:gap-4 sm:pt-8">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" width={64} height={64} className="h-14 w-14 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-sm sm:h-16 sm:w-16" />
        ) : business ? (
          <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/95 text-[22px] font-bold text-primary shadow-sm sm:h-16 sm:w-16">
            {business.trim().charAt(0).toUpperCase()}
          </span>
        ) : (
          <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><ShieldCheck className="h-7 w-7" /></span>
        )}
        {business && (
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-balance text-[18px] font-bold leading-snug sm:text-[20px]" dir="auto">{business}</p>
            {brand.tagline && <p className="mt-0.5 text-[13px] leading-snug text-white/85 sm:text-[14px]" dir="auto">{brand.tagline}</p>}
          </div>
        )}
      </div>
    </header>
  )
}

function WhatsAppIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  )
}

/** "Need help?": call the business, or open a chat with its WhatsApp number. */
function HelpCard({ help, t }: Readonly<{ help: HelpButtons; t: VerifyStrings }>) {
  if (!help.call && !help.whatsapp) return null
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <p className="text-[14px] font-semibold text-slate-800">{t.needHelp}</p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {help.call && (
          <a href={`tel:${help.call}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-[15px] font-semibold text-slate-800 transition hover:bg-slate-50 active:scale-[0.99]">
            <Phone className="h-4 w-4 text-primary" aria-hidden="true" /> {t.call}
            {help.callLabel && <span className="truncate text-[13px] font-normal tabular-nums text-slate-500" translate="no">{help.callLabel}</span>}
          </a>
        )}
        {help.whatsapp && (
          <a href={help.whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#128C7E] px-4 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]">
            <WhatsAppIcon className="h-5 w-5" /> {t.whatsapp}
          </a>
        )}
      </div>
    </div>
  )
}

function ContactCard({ business, contact }: Readonly<{ business: string; contact: NonNullable<VerifyBrand["contact"]> }>) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400" dir="auto">{business}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-slate-700">
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-primary">
            <Phone className="h-4 w-4 text-slate-400" aria-hidden="true" /> {contact.phone}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
            <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> {contact.email}
          </a>
        )}
        {contact.website && /^https?:\/\//i.test(contact.website) && (
          <a href={contact.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-primary">
            <Globe className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> {contact.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
        {contact.address && (
          <span className="inline-flex items-start gap-1.5" dir="auto">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> {contact.address}
          </span>
        )}
      </div>
    </div>
  )
}

export function VerifyView(props: Props) {
  const t = verifyStrings(props.lang)
  const rtl = isFormLang(props.lang) && langInfo(props.lang).rtl
  // The business's form colour, exactly as on its public form.
  const brandStyle = props.brand.color ? ({ "--primary": props.brand.color, "--primary-foreground": "#ffffff" } as React.CSSProperties) : undefined
  return (
    <div lang={props.lang} dir={rtl ? "rtl" : "ltr"} style={brandStyle} className="min-h-dvh bg-slate-50">
      <BusinessHeader business={props.business} brand={props.brand} />
      <main className="relative mx-auto -mt-14 w-full max-w-2xl px-4 pb-10">
        {props.mode === "message" ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-lg shadow-slate-900/5">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100"><AlertCircle className="h-7 w-7 text-slate-500" aria-hidden="true" /></span>
            <p className="mt-4 text-[15.5px] leading-relaxed text-slate-700">{props.message}</p>
            {props.retry && (
              <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-[14px] font-medium text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t.reload}
              </button>
            )}
          </div>
        ) : (
          <DetailsForm {...props} />
        )}
        <HelpCard help={props.help} t={t} />
        {props.brand.contact && props.business && <ContactCard business={props.business} contact={props.brand.contact} />}
        {props.business && (
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" /> {props.business}
          </p>
        )}
      </main>
    </div>
  )
}

function DetailsForm(props: Readonly<Extract<Props, { mode: "form" }>>) {
  const t = verifyStrings(props.lang)
  const [items, setItems] = useState(props.items)
  const [done, setDone] = useState<null | "verified" | "corrected">(props.done ? "verified" : null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | "confirm" | "correct">(null)
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null)
  const canEdit = items.some((i) => i.editable)

  // "Opened" is reported from here, once the page is really on a screen —
  // a mail or link scanner fetching the address runs no script.
  useEffect(() => {
    if (props.done) return
    void fetch(`/api/v/${encodeURIComponent(props.token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "opened" }),
    }).catch(() => {})
  }, [props.token, props.done])

  function startEdit() {
    setDraft(Object.fromEntries(items.filter((i) => i.editable).map((i) => [i.header, i.value])))
    setEditing(true)
    setError(null)
  }

  async function send(action: "confirm" | "correct") {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const values: Record<string, string> = {}
      const seen: Record<string, string> = {}
      if (action === "correct") {
        for (const i of items) {
          if (!i.editable) continue
          if ((draft[i.header] ?? "").trim() !== i.value.trim()) {
            values[i.header] = draft[i.header] ?? ""
            seen[i.header] = i.value
          }
        }
      }
      const res = await apiFetch(`/api/v/${encodeURIComponent(props.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, values, seen }),
      })
      const d = (await res.json()) as { state?: "verified" | "corrected"; items?: ViewItem[] }
      if (Array.isArray(d.items)) setItems(d.items)
      setDone(d.state ?? "verified")
      setEditing(false)
    } catch (err) {
      console.error("[verify] save failed:", err)
      const text = errorText(err, t.error)
      setError({ text, stale: /reload|updated/i.test(text) })
    } finally {
      setBusy(null)
    }
  }

  let doneText = t.thanks
  if (done === "corrected") doneText = t.thanksCorrected
  else if (props.done && !busy) doneText = t.already

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
      {done && !editing ? (
        <div role="status" className="border-b border-slate-100 px-5 pb-6 pt-8 text-center sm:px-8">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-balance text-[22px] font-bold leading-tight text-slate-900">{doneText}</h1>
        </div>
      ) : (
        <div className="border-b border-slate-100 px-5 pb-5 pt-6 sm:px-8">
          <h1 className="text-balance text-[24px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[26px]">{t.title}</h1>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-600" dir="auto">{props.intro || t.intro}</p>
          {props.deadline && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12.5px] font-medium text-amber-800">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {t.by(props.deadline)}
            </p>
          )}
        </div>
      )}

      <dl className="flex flex-col gap-2.5 px-4 py-5 sm:px-8">
        {items.map((i) => {
          const id = `v-${i.header.replace(/\W+/g, "-")}`
          const field = editing && i.editable
          return (
            <div key={i.header} className={`rounded-2xl border px-4 py-3 transition-colors ${field ? "border-primary/30 bg-primary/[0.03]" : "border-slate-100 bg-slate-50/70"}`}>
              <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500" dir="auto">
                {field ? <label htmlFor={id}>{i.header}</label> : i.header}
                {!editing && i.editable && <Pencil className="h-3 w-3 text-slate-300" aria-hidden="true" />}
              </dt>
              <dd className="mt-1">
                {field && i.options?.length ? (
                  <div className="relative">
                    <select
                      id={id}
                      value={draft[i.header] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [i.header]: e.target.value }))}
                      dir="auto"
                      className="min-h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pe-10 ps-3.5 text-[16px] text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                    >
                      {/* Today's value stays choosable even when the list no longer has it. */}
                      {i.value && !i.options.some((o) => o.toLowerCase() === i.value.toLowerCase()) && <option value={i.value}>{i.value}</option>}
                      {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  </div>
                ) : field ? (
                  <input
                    id={id}
                    value={draft[i.header] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [i.header]: e.target.value }))}
                    maxLength={200}
                    autoComplete="off"
                    dir="auto"
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[16px] text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                  />
                ) : (
                  <span className="flex items-center gap-1.5 break-words text-[16px] font-medium text-slate-900" dir="auto">
                    {i.value || <span className="font-normal text-slate-400">—</span>}
                    {!i.editable && /•/.test(i.value) && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label={t.hidden} />}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      <div className="flex flex-col gap-2.5 border-t border-slate-100 px-5 pb-6 pt-4 sm:px-8">
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[13.5px] text-rose-700">
            <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error.text}</span>
            {error.stale && (
              <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg bg-white px-3 text-[13px] font-medium text-rose-700 ring-1 ring-rose-200">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t.reload}
              </button>
            )}
          </div>
        )}
        {editing ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-slate-500">{t.editHint(props.business || "us")}</p>
            <button type="button" onClick={() => send("correct")} disabled={!!busy} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[16px] font-semibold text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.99] disabled:opacity-60">
              {busy === "correct" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {busy === "correct" ? t.saving : t.save}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(null) }} disabled={!!busy} className="min-h-11 rounded-xl text-[14px] font-medium text-slate-600 hover:bg-slate-100">
              {t.cancel}
            </button>
          </>
        ) : (
          <>
            {!done && (
              <button type="button" onClick={() => send("confirm")} disabled={!!busy} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[16px] font-semibold text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.99] disabled:opacity-60">
                {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {busy === "confirm" ? t.saving : t.allCorrect}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={startEdit} disabled={!!busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-800 transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60">
                <Pencil className="h-4 w-4" aria-hidden="true" /> {done ? t.correctAgain : t.fix}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
