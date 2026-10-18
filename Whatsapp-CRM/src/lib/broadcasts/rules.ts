/**
 * Small, pure decisions behind automatic broadcasts — kept here, apart
 * from the database, so each one is tested on its own.
 *
 *   sendWindow*      "only between 09:00 and 21:00", in the business zone
 *   frequencyCap*    "no more than 2 offers in 7 days" per person
 *   optOutIntent     a customer typing STOP / START, in several languages
 *   followUpDue      when an automatic follow-up may go
 */

// ── Send window ──────────────────────────────────────────────────────────

const WINDOW = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/

export function isSendWindow(v: unknown): v is string {
  return typeof v === 'string' && WINDOW.test(v)
}

/** Is `minutes` (minutes since local midnight) inside 'HH:MM-HH:MM'?
 *  A window that crosses midnight (21:00-06:00) works; no window = always. */
export function inSendWindow(window: string | null | undefined, minutes: number): boolean {
  if (!window) return true
  const m = WINDOW.exec(window)
  if (!m) return true
  const from = Number(m[1]) * 60 + Number(m[2])
  const to = Number(m[3]) * 60 + Number(m[4])
  if (from === to) return true
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

// ── Frequency cap ────────────────────────────────────────────────────────

export interface CapSettings {
  frequency_cap_enabled: boolean
  frequency_cap_count: number
  frequency_cap_days: number
}

/** Why a marketing message is held back from someone who already had
 *  `recent` of them in the window, or null to send. Only marketing
 *  templates are capped — a receipt or a reminder always goes. */
export function frequencyCapReason(recent: number, isMarketing: boolean, s: CapSettings): string | null {
  if (!isMarketing || !s.frequency_cap_enabled) return null
  if (recent < s.frequency_cap_count) return null
  const n = s.frequency_cap_count
  const d = s.frequency_cap_days
  return `Left out: already got ${n} offer${n === 1 ? '' : 's'} in ${d} day${d === 1 ? '' : 's'}`
}

// ── STOP / START ─────────────────────────────────────────────────────────

/** Whole-message words only: "stop" alone opts out; "please don't stop
 *  the class" does not. Matched after trimming spaces and punctuation and
 *  ignoring case. */
const STOP_WORDS = [
  'stop', 'stop all', 'stopall', 'unsubscribe', 'opt out', 'optout', 'opt-out', 'stop promotions', 'remove me',
  // Malayalam, Hindi, Tamil, Telugu, Kannada, Arabic, Spanish, Portuguese, French
  'നിർത്തുക', 'നിർത്തൂ', 'നിര്‍ത്തുക', 'बंद करो', 'रोकें', 'நிறுத்து', 'ఆపు', 'ನಿಲ್ಲಿಸಿ', 'توقف', 'إلغاء الاشتراك',
  'baja', 'cancelar suscripción', 'parar', 'sair', 'arrêt', 'désabonner',
]
const START_WORDS = ['start', 'subscribe', 'unstop', 'resume', 'opt in', 'optin', 'opt-in', 'ആരംഭിക്കുക', 'शुरू करो']

function normalise(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s‌‍]+/g, ' ')
    .replace(/^[\s.!?,;:'"“”‘’()\-]+|[\s.!?,;:'"“”‘’()\-]+$/g, '')
    .trim()
}

export function optOutIntent(text: string | null | undefined): 'stop' | 'start' | null {
  if (!text) return null
  const t = normalise(text)
  if (!t || t.length > 40) return null
  if (STOP_WORDS.includes(t)) return 'stop'
  if (START_WORDS.includes(t)) return 'start'
  return null
}

// ── Automatic follow-up ──────────────────────────────────────────────────

export interface FollowUpParent {
  status: string
  finished_at: Date | null
}

/** 'send' once the parent finished and the delay has passed; 'cancel' when
 *  the parent was cancelled; otherwise 'wait'. */
export function followUpDue(parent: FollowUpParent | null, delayMinutes: number, now: Date): 'send' | 'wait' | 'cancel' {
  if (!parent || parent.status === 'cancelled') return 'cancel'
  // An event-based parent ('active') counts from its latest run.
  if (parent.status !== 'sent' && parent.status !== 'failed' && parent.status !== 'active') return 'wait'
  if (!parent.finished_at) return 'wait'
  return now.getTime() >= parent.finished_at.getTime() + delayMinutes * 60_000 ? 'send' : 'wait'
}
