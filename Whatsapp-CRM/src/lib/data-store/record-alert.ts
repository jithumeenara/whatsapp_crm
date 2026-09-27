/**
 * "Tell me when a new row lands" — the settings, and what the message
 * says. Pure functions only, so the settings panel and the server read
 * the same rules; the sending is in record-events.ts.
 *
 * ── What is deliberately not in an alert ────────────────────────────
 *
 * An alert travels further than the Data Store does: to a phone's lock
 * screen, into an inbox, onto a staff member's WhatsApp. So a field that
 * looks like an identity or a secret — Aadhaar, PAN, passport, bank
 * account, card, password, OTP — goes out masked to its last four
 * characters, whatever the table calls it. Staff open the row for the
 * full value, behind their login. Only the first few fields are sent at
 * all, each cut short.
 */

import { ALERTABLE_SOURCES, isRecordSource, type RecordSource } from './sources'

export interface AlertCondition {
  field_key: string
  /** Compared ignoring case and surrounding spaces. */
  equals: string
}

export interface RecordAlertConfig {
  enabled: boolean
  /** Which channels a row must arrive through. Empty = any of
   *  ALERTABLE_SOURCES (never an import or an integration sync). */
  sources: RecordSource[]
  /** Team members told in the app (browser/phone notification). */
  push_user_ids: string[]
  /** Addresses sent an email, through the account's connected mailbox. */
  emails: string[]
  /** Staff WhatsApp numbers, digits with country code. */
  whatsapp_numbers: string[]
  /** An approved Utility template; without one Meta only delivers to a
   *  number that messaged the business in the last 24 hours. */
  whatsapp_template: string | null
  /** Only rows where this field has this value. */
  condition: AlertCondition | null
}

export const EMPTY_ALERT_CONFIG: RecordAlertConfig = {
  enabled: false,
  sources: [],
  push_user_ids: [],
  emails: [],
  whatsapp_numbers: [],
  whatsapp_template: null,
  condition: null,
}

export const MAX_ALERT_EMAILS = 5
export const MAX_ALERT_NUMBERS = 5
export const MAX_ALERT_MEMBERS = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/
/** Meta's own rule for template names. */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

function unique<T>(list: T[]): T[] {
  return Array.from(new Set(list))
}

/**
 * Reads stored or submitted settings into a shape that is safe to act
 * on. Anything malformed is dropped rather than rejected — the stored
 * column is JSON and may hold anything, and a bad entry must never turn
 * into a message sent somewhere nobody chose.
 *
 * `fieldKeys`, when given, drops a condition on a field the table no
 * longer has (it would otherwise match nothing and silence the alert).
 */
export function parseAlertConfig(raw: unknown, fieldKeys?: readonly string[]): RecordAlertConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_ALERT_CONFIG }
  const r = raw as Record<string, unknown>

  const sources = unique(strings(r.sources).filter(isRecordSource)).filter((s) =>
    ALERTABLE_SOURCES.includes(s),
  )

  const push = unique(strings(r.push_user_ids).filter((id) => UUID.test(id))).slice(0, MAX_ALERT_MEMBERS)

  const emails = unique(
    strings(r.emails)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length <= 254 && EMAIL.test(e)),
  ).slice(0, MAX_ALERT_EMAILS)

  const numbers = unique(
    strings(r.whatsapp_numbers)
      .map((n) => n.replace(/[^\d]/g, ''))
      .filter((n) => n.length >= 8 && n.length <= 15),
  ).slice(0, MAX_ALERT_NUMBERS)

  const template =
    typeof r.whatsapp_template === 'string' && TEMPLATE_NAME.test(r.whatsapp_template.trim())
      ? r.whatsapp_template.trim()
      : null

  let condition: AlertCondition | null = null
  const c = r.condition as Record<string, unknown> | null | undefined
  if (c && typeof c === 'object' && typeof c.field_key === 'string' && typeof c.equals === 'string') {
    const key = c.field_key.trim()
    const equals = c.equals.trim().slice(0, 200)
    if (key && equals && (!fieldKeys || fieldKeys.includes(key))) condition = { field_key: key, equals }
  }

  return {
    enabled: r.enabled === true,
    sources,
    push_user_ids: push,
    emails,
    whatsapp_numbers: numbers,
    whatsapp_template: template,
    condition,
  }
}

/** Whether a row arriving through `source` should be alerted at all. */
export function wantsSource(config: RecordAlertConfig, source: string | null | undefined): boolean {
  if (!isRecordSource(source) || !ALERTABLE_SOURCES.includes(source)) return false
  return config.sources.length === 0 || config.sources.includes(source)
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((v) => asText(v)).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value).trim()
}

export function matchesCondition(condition: AlertCondition | null, data: Record<string, unknown>): boolean {
  if (!condition) return true
  const want = condition.equals.trim().toLowerCase()
  const value = data?.[condition.field_key]
  if (Array.isArray(value)) return value.some((v) => asText(v).toLowerCase() === want)
  return asText(value).toLowerCase() === want
}

const SENSITIVE =
  /aadh?aa?r|\bpan\b|pan[\s_-]*(no|num|number|card)|passport|password|passcode|\botp\b|\bm?pin\b(?!\s*code)|cvv|card[\s_-]*(no|num|number)|account[\s_-]*(no|num|number)|acc[\s_-]*no|ifsc|\bssn\b|voter[\s_-]*id|licen[cs]e[\s_-]*(no|number)/i

const NEVER_SENT = new Set(['section_header', 'html_block'])
const SECRET_TYPES = new Set(['password', 'hidden', 'signature'])
const FILE_TYPES = new Set(['file', 'image'])

export function isSensitiveField(field: { field_key: string; label: string; field_type: string }): boolean {
  if (SECRET_TYPES.has(field.field_type)) return true
  // Keys are often snake_case ("aadhaar_no"); read them as words too.
  const words = `${field.label} ${field.field_key.replace(/[_-]+/g, ' ')}`
  return SENSITIVE.test(words)
}

export function maskValue(text: string): string {
  const compact = text.replace(/\s+/g, '')
  return compact.length > 4 ? `••••${compact.slice(-4)}` : '••••'
}

export interface SummaryLine {
  label: string
  value: string
}

/**
 * The first few filled-in fields of a row, as they may appear in an
 * alert: sensitive ones masked, files named rather than linked, every
 * value cut short.
 */
export function summarizeRecord(
  fields: ReadonlyArray<{ field_key: string; label: string; field_type: string }>,
  data: Record<string, unknown>,
  { max = 6, maxLength = 60 }: { max?: number; maxLength?: number } = {},
): SummaryLine[] {
  const lines: SummaryLine[] = []
  for (const field of fields) {
    if (lines.length >= max) break
    if (NEVER_SENT.has(field.field_type)) continue
    const raw = data?.[field.field_key]
    const text = asText(raw)
    if (!text) continue
    let value: string
    if (FILE_TYPES.has(field.field_type)) value = '(file attached)'
    else if (isSensitiveField(field)) value = maskValue(text)
    else value = text.replace(/\s+/g, ' ')
    if (value.length > maxLength) value = `${value.slice(0, maxLength - 1)}…`
    lines.push({ label: field.label.replace(/\s+/g, ' ').trim().slice(0, 40) || field.field_key, value })
  }
  return lines
}
