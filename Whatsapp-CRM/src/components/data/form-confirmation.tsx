"use client"

/**
 * The full confirmation after a public form is sent, when the business
 * switches it on: the answers asked once, everyone registered, the
 * reference and time, and a button to save or print it as a PDF.
 *
 * Built from what this person just sent, on their own screen — nothing is
 * fetched. ID numbers and bank account details are masked even here: the
 * page is often printed or shown to someone else. Any business, any
 * language; nothing in it knows what the form is for.
 */

import { CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Download, FileText, RotateCcw, Users } from "lucide-react"
import type { PublicFormField } from "@/lib/data-store/public-form"
import { isIdOrAccountColumn, maskValue } from "@/lib/verify/sheet-verify"
import type { FormStrings } from "./form-strings"

type Answers = Record<string, string | boolean | undefined>

export interface ConfirmationProps {
  t: FormStrings
  lang: string
  timeZone: string
  title: string | null
  summaryKeys: string[]
  personKeys: string[]
  showTime: boolean
  allowPrint: boolean
  fields: PublicFormField[]
  optionText(key: string, value: string): string
  shared: Answers
  people: Answers[]
  groupLabel: string | null
  /** The questions asked per person (several people in one form). */
  groupKeys: string[]
  nameKey: string | null
  message: string
  reference: string | null
  submittedAt: string | null
  copied: boolean
  onCopy(ref: string): void
  onAnother?: () => void
}

/** Day first in English ("29 September 2026"): it reads the same everywhere. */
const dateLocale = (lang: string) => (lang === "en" ? "en-GB" : lang)

const SKIP = new Set(["section_header", "html_block", "file", "image", "signature", "hidden", "password"])

/** ID and account numbers are masked, judged by the heading, the column's
 *  own name and its key (a heading in another script still has an English
 *  key). A postal PIN code, or the account holder's name, is not a secret. */
export function isMaskedAnswer(f: Pick<PublicFormField, "key" | "label" | "columnLabel" | "type">, answer: string): boolean {
  const words = [f.label, f.columnLabel, f.key.replace(/_/g, " ")].filter((w): w is string => !!w)
  // Secrets whatever they look like.
  if (words.some((w) => /password|\botp\b/i.test(w))) return true
  // A choice ("Yes", "Savings") is never a number to hide.
  if (f.type === "select" || f.type === "radio" || f.type === "boolean") return false
  // ID and account numbers are long numbers: words and short codes stay readable.
  if (answer.replace(/\D/g, "").length < 6) return false
  // A postal PIN code is an address, not a secret — unless the heading names an ID too.
  const strong = (w: string) => /aadha?a?r|\bpan\b|passport|ifsc|\bcard\b|account|\ba\s*c\b|voter|licen[cs]e/i.test(w)
  if (words.some((w) => /pin\s*code|postal/i.test(w)) && !words.some(strong)) return false
  return words.some((w) => isIdOrAccountColumn(w))
}

/** An answer as words: options in the reader's language, dates written
 *  out, yes for a tick, ID and account numbers masked. */
export function shown(f: PublicFormField, v: string | boolean | undefined, p: Pick<ConfirmationProps, "t" | "lang" | "optionText">): string {
  if (v === undefined || v === "") return ""
  if (typeof v === "boolean") return v ? p.t.yes : ""
  const text = String(v).trim()
  if (isMaskedAnswer(f, text)) return maskValue(text)
  if (f.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    try {
      return new Intl.DateTimeFormat(dateLocale(p.lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${text}T00:00:00Z`))
    } catch {
      return text
    }
  }
  if (f.type === "select" || f.type === "radio") return p.optionText(f.key, text)
  return text
}

/**
 * What the confirmation shows, from what was sent. `shared` and each
 * person hold only the questions that were asked (a question hidden by a
 * rule is not in them), so nothing that was not sent is ever shown.
 */
export function confirmationView(p: Pick<ConfirmationProps, "t" | "lang" | "optionText" | "fields" | "groupKeys" | "summaryKeys" | "personKeys" | "shared" | "nameKey" | "groupLabel">) {
  const byKey = new Map(p.fields.map((f) => [f.key, f]))
  const usable = (f: PublicFormField | undefined): f is PublicFormField => !!f && !SKIP.has(f.type)
  const personSet = new Set(p.groupKeys)

  // The summary: the business's choice, or every question asked once that has an answer.
  const summary = (p.summaryKeys.length ? p.summaryKeys.map((k) => byKey.get(k)) : p.fields.filter((f) => !personSet.has(f.key)))
    .filter(usable)
    .filter((f) => !personSet.has(f.key) && f.key in p.shared)
    .map((f) => ({ f, value: shown(f, p.shared[f.key], p) }))
    .filter((x) => x.value)

  // The people's columns: the business's choice, or their questions after the name.
  const columns = (p.personKeys.length ? p.personKeys.map((k) => byKey.get(k)) : p.fields.filter((f) => personSet.has(f.key) && f.key !== p.nameKey).slice(0, 6))
    .filter(usable)
    .filter((f) => personSet.has(f.key) && f.key !== p.nameKey)
  const nameField = p.nameKey ? byKey.get(p.nameKey) : undefined
  const personName = (a: Answers, i: number) =>
    (p.nameKey && typeof a[p.nameKey] === "string" && String(a[p.nameKey]).trim()) || p.t.personN(p.groupLabel ?? "", i + 1).trim()
  return { summary, columns, nameField, personName }
}

/** When it was saved, in the business's own zone, with the zone named. */
export function submittedText(iso: string | null, lang: string, timeZone: string): string {
  if (!iso) return ""
  try {
    return new Intl.DateTimeFormat(dateLocale(lang), { timeZone, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso))
  } catch {
    return ""
  }
}

export function FormConfirmation(p: ConfirmationProps) {
  const { summary, columns, nameField, personName } = confirmationView(p)
  const when = p.showTime ? submittedText(p.submittedAt, p.lang, p.timeZone) : ""

  return (
    <div className="flex flex-col gap-5 text-start">
      <div className="flex items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-emerald-100 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500 sm:h-16 sm:w-16 print:h-10 print:w-10">
          <CheckCircle2 className="h-8 w-8 text-emerald-700 sm:h-9 sm:w-9 print:h-6 print:w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-[20px] font-bold leading-snug text-slate-900 sm:text-[24px]" dir="auto">{p.title || p.t.confirmTitle}</h2>
          <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-slate-600" dir="auto">{p.message}</p>
          {(summary.length > 0 || p.people.length > 0) && <p className="mt-1 text-[13.5px] text-slate-500">{p.t.detailsBelow}</p>}
        </div>
      </div>

      {summary.length > 0 && (
        <section aria-labelledby="cf-details" className="rounded-2xl bg-emerald-50/60 p-4 ring-1 ring-emerald-100 sm:p-5 print:bg-white print:ring-slate-300">
          <h3 id="cf-details" className="sr-only">{p.t.detailsTitle}</h3>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {summary.map(({ f, value }) => {
              const Icon = f.type === "date" ? CalendarDays : ClipboardList
              return (
                <div key={f.key} className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary ring-1 ring-emerald-100 print:hidden">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-[12.5px] text-slate-500" dir="auto">{f.label}</dt>
                    <dd className="mt-0.5 break-words text-[15px] font-semibold leading-snug text-slate-900" dir="auto">{value}</dd>
                  </div>
                </div>
              )
            })}
          </dl>
        </section>
      )}

      {p.people.length > 0 && (
        <section aria-labelledby="cf-people">
          <h3 id="cf-people" className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" /> {p.groupLabel ? p.t.peopleTitle(p.groupLabel) : p.t.detailsTitle}
          </h3>

          {/* Wide screens and paper: a table. */}
          <div className="hidden overflow-x-auto rounded-2xl ring-1 ring-slate-200 sm:block print:block">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-primary text-start text-white print:bg-slate-100 print:text-slate-900">
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold">#</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold" dir="auto">{nameField?.label ?? p.groupLabel ?? ""}</th>
                  {columns.map((c) => <th key={c.key} scope="col" className="px-3 py-2.5 text-start font-semibold" dir="auto">{c.label}</th>)}
                  <th scope="col" className="px-3 py-2.5 text-start font-semibold"><span className="sr-only">{p.t.registered}</span></th>
                </tr>
              </thead>
              <tbody>
                {p.people.map((a, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2.5 tabular-nums text-slate-500">{i + 1}</td>
                    <th scope="row" className="px-3 py-2.5 text-start font-medium text-slate-900" dir="auto">{personName(a, i)}</th>
                    {columns.map((c) => <td key={c.key} className="px-3 py-2.5 text-slate-700" dir="auto">{shown(c, a[c.key], p) || "—"}</td>)}
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">
                        <Check className="h-3 w-3" aria-hidden="true" /> {p.t.registered}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card each. */}
          <ul className="flex flex-col gap-2.5 sm:hidden print:hidden">
            {p.people.map((a, i) => (
              <li key={i} className="rounded-2xl p-3.5 ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-[15px] font-semibold text-slate-900" dir="auto">{i + 1}. {personName(a, i)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-700">
                    <Check className="h-3 w-3" aria-hidden="true" /> {p.t.registered}
                  </span>
                </div>
                {columns.length > 0 && (
                  <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                    {columns.map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-slate-500" dir="auto">{c.label}</dt>
                        <dd className="break-words text-slate-800" dir="auto">{shown(c, a[c.key], p) || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(p.reference || when) && (
        <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-2 print:bg-white">
          {p.reference && (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200 print:hidden">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] text-slate-500">{p.t.reference}</div>
                <div className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap font-mono text-[15px] font-semibold tracking-wide text-slate-900 sm:text-[16px] sm:tracking-wider">{p.reference}</span>
                  <button
                    type="button"
                    onClick={() => p.onCopy(p.reference!)}
                    aria-label={p.copied ? `${p.t.reference} — ${p.t.copied}` : p.t.reference}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800 print:hidden"
                  >
                    {p.copied ? <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                {p.copied && <span role="status" className="text-[12px] text-emerald-700 print:hidden">{p.t.copied}</span>}
              </div>
            </div>
          )}
          {when && (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200 print:hidden">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <div className="text-[12.5px] text-slate-500">{p.t.dateTime}</div>
                <div className="text-[15px] font-medium text-slate-900">{when}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {(p.onAnother || p.allowPrint) && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-center print:hidden">
          {p.onAnother && (
            <button type="button" onClick={p.onAnother} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> {p.t.registerAnother}
            </button>
          )}
          {p.allowPrint && (
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 hover:bg-slate-50">
              <Download className="h-4 w-4" aria-hidden="true" /> {p.t.printPdf}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
