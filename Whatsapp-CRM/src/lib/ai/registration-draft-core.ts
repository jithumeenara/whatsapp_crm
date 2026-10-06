/**
 * The pure half of registering somebody from a photo (registration-draft.ts
 * does the database and the sending). Kept apart so every decision it makes
 * — what to ask next, how a typed answer matches an option, what the
 * summary says, what a tapped row means — can be tested without either.
 *
 * Nothing here knows what is being registered for. A form is whatever
 * Data Store table the account opened to the assistant; its choices are
 * whatever that table's option field reads, live. "Month first" happens
 * because there are too many choices for one WhatsApp list and they have
 * dates — for a training calendar, a clinic's slots or a course's batches
 * alike.
 */

import { createHash } from 'node:crypto'
import type { RegistrationField, RegistrationForm } from './registration'

export type Lang = 'ml' | 'en'
export type Step = 'choose_month' | 'choose' | 'ask' | 'confirm' | 'pick_edit'

/** One option of a choice field, with its date when its source table has one. */
export interface Choice {
  value: string
  /** yyyy-mm-dd, or null when it has no date. */
  date: string | null
}

/** WhatsApp's limits on an interactive list and on button titles. */
export const LIST_ROWS = 10
const ROW_TITLE = 24
const ROW_DESCRIPTION = 72
const BUTTON_TITLE = 20
const BODY = 1024

/** A month bucket for undated options when the rest are by month. */
export const NO_DATE = 'none'

// ── Words ───────────────────────────────────────────────────────────

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_ML = ['ജനുവരി', 'ഫെബ്രുവരി', 'മാർച്ച്', 'ഏപ്രിൽ', 'മേയ്', 'ജൂൺ', 'ജൂലൈ', 'ഓഗസ്റ്റ്', 'സെപ്റ്റംബർ', 'ഒക്ടോബർ', 'നവംബർ', 'ഡിസംബർ']

export const TEXT = {
  ml: {
    intro: 'നന്ദി — നിങ്ങൾ അയച്ചതിൽ നിന്ന് വിവരങ്ങൾ എടുത്തു.',
    month: 'ഏത് മാസത്തേക്കാണ് register ചെയ്യേണ്ടത്?',
    choose: (label: string) => `${label} തിരഞ്ഞെടുക്കൂ:`,
    chooseButton: 'തിരഞ്ഞെടുക്കൂ',
    more: 'കൂടുതൽ കാണുക',
    otherDates: 'മറ്റുള്ളവ',
    ask: (label: string) => `ദയവായി ${label} അയക്കൂ.`,
    askDate: (label: string) => `ദയവായി ${label} അയക്കൂ (ഉദാ: 15/10/2026).`,
    invalid: (label: string) => `${label} ശരിയായ രീതിയിലല്ല. ദയവായി വീണ്ടും അയക്കൂ.`,
    summaryHead: 'ഈ വിവരങ്ങൾ ശരിയാണോ?',
    summaryAsk: 'ഈ വിവരങ്ങൾ വെച്ച് register ചെയ്യട്ടെ?',
    yes: 'ശരി, രജിസ്റ്റർ',
    no: 'മാറ്റണം',
    pickEdit: 'ഏത് വിവരമാണ് മാറ്റേണ്ടത്?',
    cancelRow: 'റദ്ദാക്കുക',
    cancelled: 'ശരി, ഈ registration റദ്ദാക്കി.',
    saved: 'നിങ്ങളുടെ registration പൂർത്തിയായി ✅',
    already: 'നിങ്ങൾ ഇതിനകം ഇതിന് register ചെയ്തിട്ടുണ്ട്.',
    full: 'ക്ഷമിക്കണം, ഇതിൽ സീറ്റുകൾ ഒഴിവില്ല. ഞങ്ങളുടെ ടീം നിങ്ങളെ ബന്ധപ്പെടും.',
    group: 'ഇതിൽ ഒന്നിലധികം പേരുടെ വിവരങ്ങളുണ്ട്. ഞങ്ങളുടെ ടീം എല്ലാവരെയും register ചെയ്ത് നിങ്ങളെ അറിയിക്കും.',
    nothingOpen: 'ഇപ്പോൾ register ചെയ്യാൻ ഒന്നും ലഭ്യമല്ല. ഞങ്ങളുടെ ടീം നിങ്ങളെ ബന്ധപ്പെടും.',
    toTeam: 'ഞങ്ങളുടെ ടീം ഇത് പൂർത്തിയാക്കാൻ സഹായിക്കും.',
  },
  en: {
    intro: 'Thanks — I have taken your details from what you sent.',
    month: 'Which month would you like to register for?',
    choose: (label: string) => `Please choose the ${label}:`,
    chooseButton: 'Choose',
    more: 'See more',
    otherDates: 'Others',
    ask: (label: string) => `Please send your ${label}.`,
    askDate: (label: string) => `Please send the ${label} (for example 15/10/2026).`,
    invalid: (label: string) => `That does not look right for ${label}. Please send it again.`,
    summaryHead: 'Please check your details:',
    summaryAsk: 'Shall I register you with these details?',
    yes: 'Yes, register',
    no: 'No, change',
    pickEdit: 'Which detail would you like to change?',
    cancelRow: 'Cancel registration',
    cancelled: 'Okay, I have cancelled this registration.',
    saved: 'You are registered ✅',
    already: 'You are already registered for this.',
    full: 'Sorry, this one is full. Our team will get in touch about another option.',
    group: 'This has details for more than one person — our team will register everyone and let you know.',
    nothingOpen: 'There is nothing open to register for right now — our team will get in touch.',
    toTeam: 'Our team will help you finish this.',
  },
} as const

export function monthLabel(key: string, lang: Lang): string {
  if (key === NO_DATE) return TEXT[lang].otherDates
  const [y, m] = key.split('-').map(Number)
  const names = lang === 'ml' ? MONTHS_ML : MONTHS_EN
  return names[m - 1] ? `${names[m - 1]} ${y}` : key
}

function shortDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number)
  const names = lang === 'ml' ? MONTHS_ML : MONTHS_EN
  const month = names[m - 1] ?? ''
  return `${d} ${lang === 'ml' ? month : month.slice(0, 3)} ${y}`
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ── Dates ───────────────────────────────────────────────────────────

/** A date in the usual spellings, as yyyy-mm-dd; null when it is not one. */
export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const t = String(value ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  if (m) return valid(+m[3], +m[2], +m[1])
  return null
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/** Choices still open: undated ones, and those from yesterday on (a day of
 *  slack for time zones), soonest first. */
export function upcoming(choices: Choice[], today: string): Choice[] {
  const from = new Date(`${today}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 1)
  const floor = from.toISOString().slice(0, 10)
  return choices
    .filter((c) => c.date === null || c.date >= floor)
    .sort((a, b) => (a.date ?? '9999') .localeCompare(b.date ?? '9999') || a.value.localeCompare(b.value))
}

/** Whether to ask for the month first: more choices than one list holds,
 *  and dates to group them by. */
export function needsMonth(choices: Choice[]): boolean {
  return choices.length > LIST_ROWS && choices.some((c) => c.date !== null)
}

export function monthsOf(choices: Choice[]): string[] {
  const keys = [...new Set(choices.map((c) => (c.date ? c.date.slice(0, 7) : NO_DATE)))]
  return keys.sort((a, b) => (a === NO_DATE ? 1 : b === NO_DATE ? -1 : a.localeCompare(b))).slice(0, LIST_ROWS)
}

export function inMonth(choices: Choice[], month: string | null): Choice[] {
  if (!month) return choices
  return choices.filter((c) => (c.date ? c.date.slice(0, 7) === month : month === NO_DATE))
}

// ── What to ask ─────────────────────────────────────────────────────

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === ''
}

/** The first required field still without a value, in the form's order. */
export function nextMissing(form: RegistrationForm, values: Record<string, string>): RegistrationField | null {
  return form.required_fields.find((f) => isBlank(values[f.key])) ?? null
}

export function allFields(form: RegistrationForm): RegistrationField[] {
  return [...form.required_fields, ...form.optional_fields]
}

// ── Ids on tapped rows and buttons ──────────────────────────────────

/** Ten hex characters of the draft's id: enough to tell one draft from
 *  another in a conversation, short enough for every id to fit. */
export function shortId(draftId: string): string {
  return draftId.replace(/-/g, '').slice(0, 10)
}

export function optionHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

export type ReplyKind = 'month' | 'option' | 'page' | 'yes' | 'no' | 'edit' | 'cancel'
const KIND_CODE: Record<ReplyKind, string> = { month: 'm', option: 'o', page: 'p', yes: 'y', no: 'n', edit: 'e', cancel: 'x' }
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])) as Record<string, ReplyKind>

export function replyId(kind: ReplyKind, draftId: string, payload = ''): string {
  return `rg${KIND_CODE[kind]}_${shortId(draftId)}${payload ? `_${payload}` : ''}`
}

export function parseReplyId(id: string | null | undefined): { kind: ReplyKind; short: string; payload: string } | null {
  const m = /^rg([mopynex])_([0-9a-f]{10})(?:_([A-Za-z0-9_-]{1,80}))?$/.exec(id ?? '')
  if (!m) return null
  return { kind: CODE_KIND[m[1]], short: m[2], payload: m[3] ?? '' }
}

// ── Lists ───────────────────────────────────────────────────────────

export interface ListRow {
  id: string
  title: string
  description?: string
}

/** Months as list rows. */
export function monthRows(draftId: string, months: string[], lang: Lang, choices: Choice[]): ListRow[] {
  return months.map((m) => {
    const n = inMonth(choices, m).length
    const count = lang === 'ml' ? `${n} എണ്ണം` : `${n} option${n === 1 ? '' : 's'}`
    return { id: replyId('month', draftId, m), title: cut(monthLabel(m, lang), ROW_TITLE), description: count }
  })
}

/** One page of choices: all of them when they fit, else nine and "See more". */
export function choiceRows(draftId: string, choices: Choice[], page: number, lang: Lang): ListRow[] {
  const fits = choices.length <= LIST_ROWS
  const size = fits ? LIST_ROWS : LIST_ROWS - 1
  const start = fits ? 0 : page * size
  const slice = choices.slice(start, start + size)
  const rows: ListRow[] = slice.map((c) => ({
    id: replyId('option', draftId, optionHash(c.value)),
    title: cut(c.value, ROW_TITLE),
    // The full name when the title had to be cut, and the date.
    description: cut([c.value.length > ROW_TITLE ? c.value : '', c.date ? shortDate(c.date, lang) : ''].filter(Boolean).join(' · '), ROW_DESCRIPTION) || undefined,
  }))
  if (!fits && start + size < choices.length) rows.push({ id: replyId('page', draftId, String(page + 1)), title: TEXT[lang].more })
  return rows
}

/** Two or three short choices read better as buttons than as a list. */
export function asButtons(choices: Choice[]): boolean {
  return choices.length <= 3 && choices.every((c) => c.value.length <= BUTTON_TITLE)
}

// ── Typed answers ───────────────────────────────────────────────────

function norm(t: string): string {
  // \p{M} kept: Malayalam's vowel signs and virama are combining marks,
  // and dropping them turns "ഒക്ടോബർ" into letters no word matches.
  return t.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** A typed month — "October", "oct 2026", "10", "2026-10", "ഒക്ടോബർ" —
 *  when it names exactly one of the months on offer. */
export function matchMonth(text: string, months: string[]): string | null {
  const t = norm(text)
  if (!t) return null
  const hits = months.filter((key) => {
    if (key === NO_DATE) return false
    const [y, m] = key.split('-')
    const n = Number(m)
    const en = MONTHS_EN[n - 1].toLowerCase()
    const ml = MONTHS_ML[n - 1]
    const words = t.split(' ')
    const named = words.some((w) => w === en || (w.length >= 3 && en.startsWith(w))) || t.includes(ml)
    const numbered = t === String(n) || t === m || t === `${y} ${m}` || t === `${m} ${y}`
    const yearOk = !/\b(19|20)\d{2}\b/.test(t) || t.includes(y)
    return (named || numbered) && yearOk
  })
  return hits.length === 1 ? hits[0] : null
}

/** A typed choice, when it names exactly one: the whole option, or a part
 *  of it no other option shares. A number picks from the list as shown. */
export function matchChoice(text: string, choices: Choice[], shown?: Choice[]): Choice | null {
  const t = norm(text)
  if (!t) return null
  if (/^\d{1,2}$/.test(t) && shown) {
    const i = Number(t) - 1
    return shown[i] ?? null
  }
  const exact = choices.filter((c) => norm(c.value) === t)
  if (exact.length === 1) return exact[0]
  if (t.length < 3) return null
  const partial = choices.filter((c) => norm(c.value).includes(t) || (t.length >= 6 && t.includes(norm(c.value))))
  return partial.length === 1 ? partial[0] : null
}

/** "cancel", "stop", "റദ്ദാക്കൂ" — the whole message. */
export function isCancel(text: string): boolean {
  return /^(cancel|cancel (it|this|registration)|stop|abort|റദ്ദാക്കൂ|റദ്ദാക്കുക|റദ്ദ് ചെയ്യൂ)$/.test(norm(text))
}

/** A question or a long message is the customer saying something else,
 *  not answering the detail asked for. */
export function looksLikeSomethingElse(text: string): boolean {
  const t = text.trim()
  return t.endsWith('?') || t.length > 150
}

// ── The summary ─────────────────────────────────────────────────────

/** How a value is shown back in chat. A long run of digits in anything
 *  but a phone number — an account number — shows only its last four;
 *  the full value is what is stored. */
export function displayValue(field: RegistrationField, value: string): string {
  if (field.type === 'phone') return value
  return value.replace(/\d{9,}/g, (run) => `XXXX${run.slice(-4)}`)
}

export function summaryText(form: RegistrationForm, values: Record<string, string>, lang: Lang): string {
  const t = TEXT[lang]
  const lines = allFields(form)
    .filter((f) => !isBlank(values[f.key]))
    .map((f) => `• ${f.label}: ${displayValue(f, values[f.key])}`)
  const head = `${t.summaryHead}\n\n`
  const tail = `\n\n${t.summaryAsk}`
  let body = lines.join('\n')
  const room = BODY - head.length - tail.length
  if (body.length > room) body = `${body.slice(0, room - 1)}…`
  return `${head}${body}${tail}`
}

/** The details that can be changed, as list rows, and a way out. */
export function editRows(draftId: string, form: RegistrationForm, values: Record<string, string>, lang: Lang): ListRow[] {
  const rows: ListRow[] = allFields(form)
    .filter((f) => !isBlank(values[f.key]) && /^[A-Za-z0-9_-]{1,60}$/.test(f.key))
    .slice(0, LIST_ROWS - 1)
    .map((f) => ({
      id: replyId('edit', draftId, f.key),
      title: cut(f.label, ROW_TITLE),
      description: cut(displayValue(f, values[f.key]), ROW_DESCRIPTION),
    }))
  rows.push({ id: replyId('cancel', draftId), title: TEXT[lang].cancelRow })
  return rows
}

/** A typed answer to "which detail?" — a label it names on its own. */
export function matchField(text: string, form: RegistrationForm): RegistrationField | null {
  const t = norm(text)
  if (t.length < 2) return null
  const hits = allFields(form).filter((f) => norm(f.label) === t || norm(f.label).includes(t) || norm(f.key) === t)
  return hits.length === 1 ? hits[0] : null
}

export function buttonTitle(text: string): string {
  return cut(text, BUTTON_TITLE)
}
