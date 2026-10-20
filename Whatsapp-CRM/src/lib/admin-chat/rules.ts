/**
 * Admin Chat — the rules, with no database and no network, so every one
 * of them is tested on its own (rules.test.ts).
 *
 * Times are the business's own (businessTimezone), never the server
 * clock's: "Monday 9–6 until 31 October" means that in Kerala even when
 * the server runs in UTC.
 */

import crypto from 'crypto'

export const MAX_MEMBERS = 5
export const MAX_FAILURES = 5
export const LOCK_MINUTES = 15
export const CODE_MINUTES = 3
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

const WEEKDAY: Record<string, DayKey> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' }

export interface LocalNow {
  day: DayKey
  minutes: number
  /** YYYY-MM-DD in the business zone. */
  date: string
}

export function localNow(timezone: string, now: Date = new Date()): LocalNow {
  const read = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = read(timezone || 'Asia/Kolkata')
  } catch {
    parts = read('Asia/Kolkata')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    day: WEEKDAY[get('weekday')] ?? 'mon',
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

export interface MemberWindow {
  valid_from: Date
  valid_until: Date
  allowed_days: string[]
  start_minute: number
  end_minute: number
}

export type WindowResult = { ok: true } | { ok: false; reason: 'not_started' | 'expired' | 'day' | 'hours' }

/** A DATE column comes back as UTC midnight; its calendar day is what counts. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function windowCheck(member: MemberWindow, local: LocalNow): WindowResult {
  if (local.date < dateKey(member.valid_from)) return { ok: false, reason: 'not_started' }
  if (local.date > dateKey(member.valid_until)) return { ok: false, reason: 'expired' }
  if (!member.allowed_days.includes(local.day)) return { ok: false, reason: 'day' }
  if (local.minutes < member.start_minute || local.minutes >= member.end_minute) return { ok: false, reason: 'hours' }
  return { ok: true }
}

function hhmm(m: number): string {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** "Mon, Tue, Wed, Thu, Fri, Sat · 09:00–18:00 · 2026-10-01 to 2026-10-31" */
export function describeWindow(member: MemberWindow): string {
  const days = DAY_KEYS.filter((d) => member.allowed_days.includes(d)).map((d) => d[0].toUpperCase() + d.slice(1))
  const hours = member.start_minute === 0 && member.end_minute === 1440 ? 'any time' : `${hhmm(member.start_minute)}–${hhmm(member.end_minute === 1440 ? 1439 : member.end_minute)}`
  return `${days.length === 7 ? 'Every day' : days.join(', ')} · ${hours} · ${dateKey(member.valid_from)} to ${dateKey(member.valid_until)}`
}

export interface SessionTimes {
  state: string
  started_at: Date | null
  last_activity_at: Date
  code_expires_at: Date | null
}

export type ExpiryReason = 'idle' | 'max' | 'code_timeout'

export function sessionExpiry(s: SessionTimes, settings: { idle_minutes: number; max_minutes: number }, now: Date = new Date()): ExpiryReason | null {
  if (s.state === 'awaiting_code') {
    return s.code_expires_at && now >= s.code_expires_at ? 'code_timeout' : null
  }
  if (s.state !== 'active') return null
  if (s.started_at && now.getTime() - s.started_at.getTime() >= settings.max_minutes * 60_000) return 'max'
  if (now.getTime() - s.last_activity_at.getTime() >= settings.idle_minutes * 60_000) return 'idle'
  return null
}

export function isKeyword(text: string, keyword: string): boolean {
  return text.trim().toLowerCase() === keyword.trim().toLowerCase() && keyword.trim().length > 0
}

const STOP_WORDS = new Set(['stop', 'logout', 'log out', 'exit', 'end', 'quit', 'നിർത്തുക'])
export function isStop(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase())
}

/** The enrolment code shown on the web: "CRM-482913". */
export function parseVerifyCode(text: string): string | null {
  const m = text.trim().match(/^CRM[\s-]?(\d{6})$/i)
  return m ? m[1] : null
}

export function newVerifyCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(`admin-chat:${code}`).digest('hex')
}

/** After this many failures in a row the admin waits LOCK_MINUTES. */
export function lockAfterFailure(failures: number, now: Date = new Date()): Date | null {
  return failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
}

/**
 * Numbers that identify a person (8+ digits, however spaced — phones,
 * Aadhaar, account numbers) keep their first 2 and last 3 digits; emails
 * keep their first letter and domain. Amounts with commas and dates are
 * left alone (their digit runs are short).
 */
export function maskSensitive(text: string): string {
  // Digits grouped by single spaces only, so "20-10-2026" stays a date; a
  // "+91 " country code is kept as it is.
  // A comma only belongs to the number when a digit follows it ("1,25,000").
  const masked = text.replace(/(?<!\d|\d,|\+)(\+\d{1,3} )?(\d(?: ?\d){7,})(?!\d|,\d)/g, (_run, cc: string | undefined, num: string) => {
    const digits = num.replace(/\D/g, '')
    return `${cc ?? ''}${digits.slice(0, 2)}•••••${digits.slice(-3)}`
  })
  return masked
    .replace(/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1•••@$2')
}

/** JSON with keys sorted at every level — Postgres JSONB does not keep key
 *  order, so the hash must not depend on it. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function auditHash(prevHash: string, rec: { accountId: string; event: string; detail: unknown; createdAt: Date }): string {
  return crypto
    .createHash('sha256')
    .update([prevHash, rec.accountId, rec.event, stableJson(rec.detail ?? {}), rec.createdAt.toISOString()].join('|'))
    .digest('hex')
}
