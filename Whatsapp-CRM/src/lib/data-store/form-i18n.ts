/**
 * A public form in more than one language, chosen by the business.
 *
 * The questions are written once, in the form's main language. Each extra
 * language holds the business's own translations, keyed by a path:
 *   title · intro · success · consent · group
 *   label:<field>  help:<field>  opt:<field>:<value>  ui:<word>
 * Every entry remembers the text it was translated from, so when the main
 * text changes the old translation is not shown — it waits for a check.
 *
 * Only what the reader SEES changes. An option is still saved as written
 * (opt:month:november shows "നവംബർ", saves "november"), so filters, sheets,
 * reports and links between questions work exactly as before.
 */

export const FORM_LANGS = [
  { code: 'en', name: 'English', native: 'English', rtl: false },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', rtl: false },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', rtl: false },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', rtl: false },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', rtl: false },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', rtl: false },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
] as const

export type FormLang = (typeof FORM_LANGS)[number]['code']

const CODES = new Set<string>(FORM_LANGS.map((l) => l.code))
export const MAX_EXTRA_LANGS = 3
/** Entries kept per language; a long lookup table is cut here. */
export const MAX_COPY_ENTRIES = 600
const MAX_TEXT = 600

export function isFormLang(v: unknown): v is FormLang {
  return typeof v === 'string' && CODES.has(v)
}

export function langInfo(code: FormLang) {
  return FORM_LANGS.find((l) => l.code === code) ?? FORM_LANGS[0]
}

export interface FormLanguages {
  /** The language the questions are written in. */
  main: FormLang
  /** Also offered on the form, in this order. */
  extra: FormLang[]
}

export const DEFAULT_LANGUAGES: FormLanguages = { main: 'en', extra: [] }

/** Forms made before languages could be chosen offered English and Malayalam. */
export const LEGACY_LANGUAGES: FormLanguages = { main: 'en', extra: ['ml'] }

export function parseLanguages(raw: unknown): FormLanguages {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...LEGACY_LANGUAGES, extra: [...LEGACY_LANGUAGES.extra] }
  const r = raw as Record<string, unknown>
  const main = isFormLang(r.main) ? r.main : 'en'
  const extra = Array.isArray(r.extra)
    ? Array.from(new Set(r.extra.filter(isFormLang))).filter((l) => l !== main).slice(0, MAX_EXTRA_LANGS)
    : []
  return { main, extra }
}

export function formLangList(l: FormLanguages): FormLang[] {
  return [l.main, ...l.extra]
}

/** One translation: the words, and the main-language text they came from. */
export interface CopyEntry {
  t: string
  s: string
}

/** language → path → entry */
export type FormCopy = Partial<Record<FormLang, Record<string, CopyEntry>>>

const PATH = /^(title|intro|success|consent|group|ctitle|(label|help):[A-Za-z0-9_-]{1,100}|opt:[A-Za-z0-9_-]{1,100}:[\s\S]{1,500}|ui:[A-Za-z]{1,40})$/

export function isCopyPath(p: string): boolean {
  return PATH.test(p)
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\r\n/g, '\n').trim().slice(0, max)
  return t || null
}

/** The form's plain words a business may reword (ui:<word>); the same
 *  list as UI_TEXT_KEYS in components/data/form-strings.ts (a test holds them equal). */
export const FORM_UI_WORDS: ReadonlySet<string> = new Set([
  'required', 'submit', 'sending', 'choose', 'yes', 'draftFound', 'restore', 'startOver', 'thanks', 'submitted',
  'reference', 'copied', 'another', 'errRequired', 'errTick', 'errEmail', 'errPhone', 'errUrl', 'errNumber', 'errTime',
  'errConsent', 'errCheck', 'errNetwork', 'errTooMany', 'errGeneric', 'closed', 'full', 'personalOnly', 'thisBusiness',
  'language', 'filledForYou', 'searchOptions', 'noMatch', 'contact', 'save', 'saveAndAdd', 'cancel', 'edit', 'remove',
  'keep', 'discardPerson', 'close',
  'confirmTitle', 'detailsBelow', 'detailsTitle', 'registered', 'dateTime', 'printPdf', 'registerAnother',
])

/** All translations of one form together, in characters: the public page reads them on every visit. */
export const MAX_COPY_CHARS = 300_000

/** Stored or submitted translations. A language switched off, or made the
 *  main one, keeps its translations, so switching back brings them back.
 *  The form words (ui:*) never count toward the per-language limit. When
 *  a limit cuts anything, `report.cut` says so, so a save can refuse
 *  rather than quietly drop words. */
export function parseCopy(raw: unknown, report?: { cut: boolean }): FormCopy {
  const out: FormCopy = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let chars = 0
  for (const { code: lang } of FORM_LANGS) {
    const block = (raw as Record<string, unknown>)[lang]
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const entries: Record<string, CopyEntry> = {}
    let n = 0
    for (const [path, v] of Object.entries(block as Record<string, unknown>)) {
      if (!isCopyPath(path) || !v || typeof v !== 'object') continue
      const ui = path.startsWith('ui:')
      if (ui && !FORM_UI_WORDS.has(path.slice(3))) continue
      const e = v as Record<string, unknown>
      const t = clean(e.t, MAX_TEXT)
      const s = typeof e.s === 'string' ? e.s.slice(0, MAX_TEXT) : ''
      if (!t) continue
      const size = path.length + t.length + s.length
      if ((!ui && n >= MAX_COPY_ENTRIES) || chars + size > MAX_COPY_CHARS) {
        if (report) report.cut = true
        continue
      }
      chars += size
      entries[path] = { t, s }
      if (!ui) n++
    }
    if (Object.keys(entries).length) out[lang] = entries
  }
  return out
}

/** A value worth translating: words, not a date, number or time. */
export function isWords(v: string): boolean {
  return /\p{L}/u.test(v) && !/^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v)
}

export interface CopySource {
  path: string
  /** The main-language text. */
  text: string
  /** Where it shows, for the settings table. */
  where: string
}

interface SourceField {
  key: string
  label: string
  type: string
  help?: string
  options?: string[]
}

/**
 * Every piece of the business's text a reader sees, in form order: the
 * heading, each question, its help, its options (also those coming from
 * another table), and values a question is filled with.
 */
export function copySources(form: {
  title: string
  intro: string | null
  success: string | null
  consent: string | null
  groupLabel: string | null
  /** The confirmation page's own heading, when set. */
  confirmTitle?: string | null
  fields: readonly SourceField[]
  /** field → the option values it can show or be filled with */
  values?: Record<string, readonly string[]>
}): CopySource[] {
  const out: CopySource[] = []
  const seen = new Set<string>()
  const add = (path: string, text: string | null | undefined, where: string) => {
    const t = text?.trim()
    if (!t || seen.has(path) || out.length >= MAX_COPY_ENTRIES || !isCopyPath(path)) return
    seen.add(path)
    out.push({ path, text: t.slice(0, MAX_TEXT), where })
  }
  add('title', form.title, 'Form title')
  add('intro', form.intro, 'Intro')
  add('group', form.groupLabel, 'One person is a')
  for (const f of form.fields) {
    add(`label:${f.key}`, f.label, f.type === 'section_header' ? 'Section' : 'Question')
    add(`help:${f.key}`, f.help, `Help · ${f.label}`)
    for (const raw of f.options ?? []) { const o = raw.trim(); if (isWords(o)) add(`opt:${f.key}:${o}`, o, `Option · ${f.label}`) }
    for (const v of form.values?.[f.key] ?? []) if (isWords(v)) add(`opt:${f.key}:${v}`, v, `Option · ${f.label}`)
  }
  add('consent', form.consent, 'Consent')
  add('success', form.success, 'Thank-you message')
  add('ctitle', form.confirmTitle, 'Confirmation heading')
  return out
}

/**
 * The translations a reader gets in `lang`: only those made from today's
 * main text. Option entries name their own source, so they hold while the
 * option exists. The form's own words (ui:*) always hold.
 */
export function liveCopy(copy: FormCopy, lang: FormLang, sources: readonly CopySource[], main?: FormLang): Record<string, string> {
  const entries = copy[lang]
  if (!entries) return {}
  const now = new Map(sources.map((s) => [s.path, s.text]))
  const out: Record<string, string> = {}
  for (const [path, e] of Object.entries(entries)) {
    if (path.startsWith('ui:')) {
      if (FORM_UI_WORDS.has(path.slice(3))) out[path] = e.t
    } else if (lang !== main && now.has(path) && now.get(path) === e.s) {
      // The main language shows the questions as written.
      out[path] = e.t
    }
  }
  return out
}

/** Entries whose main text has changed since they were translated. */
export function staleCopy(copy: FormCopy, lang: FormLang, sources: readonly CopySource[]): Set<string> {
  const entries = copy[lang] ?? {}
  const now = new Map(sources.map((s) => [s.path, s.text]))
  const out = new Set<string>()
  for (const [path, e] of Object.entries(entries)) {
    if (!path.startsWith('ui:') && now.has(path) && now.get(path) !== e.s) out.add(path)
  }
  return out
}

/** The reader's language: ?lang= if offered, else the phone's, else the main one. */
export function pickLang(langs: FormLanguages, wanted: readonly (string | null | undefined)[]): FormLang {
  const offered = formLangList(langs)
  for (const w of wanted) {
    const code = (w ?? '').toLowerCase().split(/[-_]/)[0]
    if (isFormLang(code) && offered.includes(code)) return code
  }
  return langs.main
}
