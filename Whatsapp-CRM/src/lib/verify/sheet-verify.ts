/**
 * People checking their own details, straight from a Google Sheet — the
 * parts with no database or network, so they can be tested alone.
 *
 * The sheet stays the master list. Each row gets a reference in a
 * "Verify ref" column; the person's private link carries that reference,
 * signed, so it cannot be made up or changed. Opening it shows that one
 * row (sensitive columns masked); they confirm it or correct the columns
 * the business allows, and the change is written back to the same row.
 *
 * Works for any business and any sheet: columns are found by their
 * header, never by letter, and nothing here knows what the list is for.
 */


export const REF_HEADER = 'Verify ref'
export const STATUS_HEADER = 'Verify status'
export const LOG_TAB = 'Verification log'
export const LOG_HEADERS = ['Time', REF_HEADER, 'Column', 'Before', 'After', 'By'] as const
export const MAX_ROWS = 2000
export const MAX_VALUE = 200

// ── Columns ────────────────────────────────────────────────────────────

const norm = (h: unknown) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** The column with this header, or -1. */
export function columnOf(headers: readonly string[], header: string | null | undefined): number {
  if (!header) return -1
  const want = norm(header)
  return want ? headers.findIndex((h) => norm(h) === want) : -1
}

/** ID numbers, bank account details, secrets — and any phone number
 *  column, not only the one messages go to: shown masked, never editable.
 *  A bank's or society's NAME is not one of them: "Name of Bank" is
 *  exactly what a person may need to correct, so the word "bank" alone
 *  does not lock a column here — an account number, IFSC or card does. */
export function isSensitiveColumn(header: string): boolean {
  const h = header.replace(/[_/]/g, ' ')
  if (/aadha?a?r|\bpan\b|passport|ifsc|\bcard\b|password|\botp\b|\bpin\b|voter|licen[cs]e|\ba\s*c\b|account|\bacc(t)?\b/i.test(h)) return true
  if (/phone|mobile|whats\s*app|contact\s*(no|number)|\bcell\b/i.test(h)) return true
  // "Bank" with a number word: "Bank No", "Bank number" — not "Name of Bank".
  return /\bbank\b.*\b(no|number|num)\b/i.test(h)
}

/** "98•••••183"-style: enough to recognise, not enough to use. */
export function maskValue(value: string): string {
  const v = value.trim()
  if (v.length <= 4) return '•'.repeat(v.length)
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 6) return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
  return `${v.slice(0, 1)}${'•'.repeat(Math.min(8, v.length - 2))}${v.slice(-1)}`
}

export interface VerifySetup {
  name_column: string | null
  phone_column: string | null
  email_column: string | null
  show_columns: string[]
  edit_columns: string[]
  filter_column: string | null
  filter_value: string | null
}

/** Settings as stored or sent: header lists cleaned, the editable ones a
 *  subset of those shown, and never a contact, reference or sensitive column. */
export function cleanSetup(raw: Partial<Record<keyof VerifySetup, unknown>>): VerifySetup {
  const header = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null)
  const list = (v: unknown) =>
    Array.from(new Set((Array.isArray(v) ? v : []).map(header).filter((h): h is string => !!h))).slice(0, 40)
  const phone = header(raw.phone_column)
  const email = header(raw.email_column)
  const fixed = new Set([phone, email, REF_HEADER, STATUS_HEADER].filter(Boolean).map((h) => norm(h)))
  const show = list(raw.show_columns).filter((h) => norm(h) !== norm(REF_HEADER) && norm(h) !== norm(STATUS_HEADER))
  const shown = new Set(show.map(norm))
  const name = header(raw.name_column)
  const edit = list(raw.edit_columns).filter(
    (h) => (shown.has(norm(h)) || norm(h) === norm(name)) && !fixed.has(norm(h)) && !isSensitiveColumn(h),
  )
  return {
    name_column: name,
    phone_column: phone,
    email_column: email,
    show_columns: show,
    edit_columns: edit,
    filter_column: header(raw.filter_column),
    filter_value: typeof raw.filter_value === 'string' && raw.filter_value.trim() ? raw.filter_value.trim().slice(0, 200) : null,
  }
}

/** Whether a row belongs to this check (the filter, and not empty). */
export function inScope(setup: VerifySetup, headers: readonly string[], row: readonly string[]): boolean {
  if (!row.some((c) => String(c ?? '').trim())) return false
  if (!setup.filter_column || setup.filter_value === null) return true
  const i = columnOf(headers, setup.filter_column)
  return i >= 0 && norm(row[i]) === norm(setup.filter_value)
}

export interface ViewItem {
  header: string
  /** As the person sees it: masked when sensitive or a contact detail. */
  value: string
  editable: boolean
}

/** What the person sees of their row: their name first, then the shown
 *  columns, in the business's order. */
export function personView(setup: VerifySetup, headers: readonly string[], row: readonly string[]): ViewItem[] {
  const cols = [setup.name_column, ...setup.show_columns].filter((h): h is string => !!h)
  const seen = new Set<string>()
  const edit = new Set(setup.edit_columns.map(norm))
  const contact = new Set([setup.phone_column, setup.email_column].filter(Boolean).map((h) => norm(h)))
  const out: ViewItem[] = []
  for (const h of cols) {
    const i = columnOf(headers, h)
    if (i < 0 || seen.has(norm(h))) continue
    seen.add(norm(h))
    const raw = String(row[i] ?? '').trim()
    const hidden = isSensitiveColumn(h) || contact.has(norm(h))
    out.push({ header: headers[i].trim() || h, value: hidden && raw ? maskValue(raw) : raw, editable: edit.has(norm(h)) && !hidden })
  }
  return out
}

export interface Change {
  col: number
  header: string
  before: string
  after: string
}

/**
 * The corrections a person sent, checked against today's row: only
 * editable columns, plain short text, and only what really changed. `seen`
 * is what their page showed; when the sheet has changed since, they are
 * asked to reload rather than overwrite someone else's newer edit.
 */
export function corrections(
  setup: VerifySetup,
  headers: readonly string[],
  row: readonly string[],
  values: unknown,
  seen: unknown,
): { ok: true; changes: Change[] } | { ok: false; problem: string; stale?: boolean } {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, problem: 'Nothing was sent.' }
  const edit = new Set(setup.edit_columns.map(norm))
  const before = seen && typeof seen === 'object' && !Array.isArray(seen) ? (seen as Record<string, unknown>) : {}
  const changes: Change[] = []
  for (const [header, v] of Object.entries(values as Record<string, unknown>)) {
    if (!edit.has(norm(header)) || isSensitiveColumn(header)) return { ok: false, problem: `“${header.slice(0, 60)}” cannot be changed here.` }
    const col = columnOf(headers, header)
    if (col < 0) return { ok: false, problem: `“${header.slice(0, 60)}” is no longer in the list.` }
    if (typeof v !== 'string') return { ok: false, problem: 'Each answer must be text.' }
    const after = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (!after) return { ok: false, problem: `“${headers[col].trim()}” cannot be left empty.` }
    if (after.length > MAX_VALUE) return { ok: false, problem: `“${headers[col].trim()}” can be at most ${MAX_VALUE} characters.` }
    const now = String(row[col] ?? '').trim()
    if (typeof before[header] === 'string' && (before[header] as string).trim() !== now) {
      return { ok: false, stale: true, problem: 'Your details were just updated. Reload the page to see the latest, then correct them again.' }
    }
    if (after !== now) changes.push({ col, header: headers[col].trim(), before: now, after })
  }
  return { ok: true, changes }
}

// ── Messages ───────────────────────────────────────────────────────────

/** What can fill a template's {{n}}, or {{name}} in an SMS or email. */
export interface MessageValues {
  name: string
  link: string
  deadline: string
  business: string
  ref: string
}

export const PARAM_CHOICES = ['name', 'link', 'deadline', 'business', 'ref'] as const

/** A template's {{1}}, {{2}}… from the business's choices: a fixed value,
 *  or "col:<header>" for a column of the row (never a sensitive one). */
export function templateValues(
  spec: readonly unknown[],
  values: MessageValues,
  headers: readonly string[],
  row: readonly string[],
): string[] {
  return spec.map((s) => {
    const key = typeof s === 'string' ? s : ''
    if ((PARAM_CHOICES as readonly string[]).includes(key)) return values[key as keyof MessageValues] || '-'
    if (key.startsWith('col:')) {
      const header = key.slice(4)
      if (isSensitiveColumn(header)) return '-'
      const i = columnOf(headers, header)
      return (i >= 0 && String(row[i] ?? '').trim()) || '-'
    }
    return '-'
  })
}

/** {{name}}, {{link}}, {{deadline}}, {{business}}, {{ref}} in a business's own text. */
export function fillText(text: string, values: MessageValues): string {
  return text.replace(/\{\{\s*(name|link|deadline|business|ref)\s*\}\}/gi, (_, k: string) => values[k.toLowerCase() as keyof MessageValues] || '')
}

/** Why a row cannot get a message on this channel, or null. */
export function cannotSend(channel: 'whatsapp' | 'sms' | 'email', address: string | null): string | null {
  if (channel === 'email') return address && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) ? null : address ? 'Not an email address' : 'No email'
  return address ? null : 'No valid phone number'
}

// ── Settings from the admin screen ─────────────────────────────────────

export interface VerificationInput extends VerifySetup {
  name: string
  spreadsheet_id: string
  spreadsheet_name: string | null
  tab_title: string
  deadline: Date | null
  language: string
  intro: string | null
  template_name: string | null
  template_params: string[]
  sms_text: string | null
  email_subject: string | null
  email_text: string | null
  status: 'active' | 'closed'
}

const LANGS = new Set(['en', 'ml', 'hi', 'ta', 'kn', 'te', 'ar'])

/** Each allowed field copied and checked on its own; nothing else is taken. */
export function cleanVerificationInput(raw: unknown): { ok: true; data: VerificationInput } | { ok: false; problem: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problem: 'Nothing was sent.' }
  const r = raw as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : null)
  const name = text(r.name, 100)
  if (!name) return { ok: false, problem: 'Give this check a name.' }
  const spreadsheet = typeof r.spreadsheet_id === 'string' ? r.spreadsheet_id.trim() : ''
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheet)) return { ok: false, problem: 'Choose a Google Sheet.' }
  const tab = text(r.tab_title, 100)
  if (!tab) return { ok: false, problem: 'Choose the tab the list is on.' }
  const setup = cleanSetup(r as Partial<Record<keyof VerifySetup, unknown>>)
  if (!setup.name_column) return { ok: false, problem: 'Choose the column with each person’s name.' }
  if (!setup.phone_column && !setup.email_column) return { ok: false, problem: 'Choose the column with their phone number or email.' }
  let deadline: Date | null = null
  if (typeof r.deadline === 'string' && r.deadline) {
    const d = new Date(r.deadline)
    if (Number.isNaN(d.getTime())) return { ok: false, problem: 'The deadline is not a date.' }
    deadline = d
  }
  const template = text(r.template_name, 512)
  if (template && !/^[a-z0-9_]+$/.test(template)) return { ok: false, problem: 'That is not a WhatsApp template name.' }
  const params = (Array.isArray(r.template_params) ? r.template_params : []).slice(0, 10).map((p) => {
    const s = typeof p === 'string' ? p.trim() : ''
    if ((PARAM_CHOICES as readonly string[]).includes(s)) return s
    if (s.startsWith('col:') && s.length <= 104 && !isSensitiveColumn(s.slice(4))) return s
    return ''
  })
  return {
    ok: true,
    data: {
      ...setup,
      name,
      spreadsheet_id: spreadsheet,
      spreadsheet_name: text(r.spreadsheet_name, 200),
      tab_title: tab,
      deadline,
      language: typeof r.language === 'string' && LANGS.has(r.language) ? r.language : 'en',
      intro: text(r.intro, 1000),
      template_name: template,
      template_params: params,
      sms_text: text(r.sms_text, 600),
      email_subject: text(r.email_subject, 150),
      email_text: text(r.email_text, 3000),
      status: r.status === 'closed' ? 'closed' : 'active',
    },
  }
}
