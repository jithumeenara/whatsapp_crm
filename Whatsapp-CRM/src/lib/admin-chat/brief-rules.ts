/**
 * Admin Chat briefs and alerts — the rules, with no database or network
 * (tested in brief-rules.test.ts). A brief carries counts only.
 */

export const BRIEF_LATE_MINUTES = 180
export const ALERT_EVERY_MS = 3 * 60 * 60_000
export const SERVICE_WINDOW_MS = 24 * 60 * 60_000

/** Minutes a zone is ahead of UTC at a moment (e.g. Kolkata: 330). */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** The start of a business day (YYYY-MM-DD in `timeZone`) as a real moment. */
function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Twice: the offset at the guess can differ from the offset at the answer around DST.
  let t = guess - offsetMinutes(timeZone, new Date(guess)) * 60_000
  t = guess - offsetMinutes(timeZone, new Date(t)) * 60_000
  return new Date(t)
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

export function zonedDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  let zone = timeZone
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
  } catch {
    zone = 'Asia/Kolkata'
  }
  return { start: zonedMidnight(date, zone), end: zonedMidnight(nextDate(date), zone) }
}

export interface BriefStats {
  /** The day the "yesterday" figures are for (business date). */
  date: string
  newChats: number
  byChannel: Record<string, number>
  newLeads: number
  customerMessages: number
  waitingNow: number
  unassignedNow: number
}

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  facebook: 'Messenger',
  website: 'Website',
  email: 'Email',
  sms: 'SMS',
  rcs: 'RCS',
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export function composeBrief(s: BriefStats, keyword: string): string {
  const channels = Object.entries(s.byChannel)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${CHANNEL_NAMES[c] ?? c} ${n}`)
    .join(' · ')
  return [
    `📊 *Daily brief* — ${dayLabel(s.date)}`,
    `• New chats: *${s.newChats}*${channels ? ` (${channels})` : ''}`,
    `• New leads: *${s.newLeads}*`,
    `• Customer messages: *${s.customerMessages}*`,
    `• Waiting for the team now: *${s.waitingNow}*`,
    `• Unassigned open chats now: *${s.unassignedNow}*`,
    '',
    `Reply *${keyword}* for details.`,
  ].join('\n')
}

/** For a template variable: Meta refuses line breaks inside one. */
export function briefOneLine(s: BriefStats): string {
  return `${s.newChats} new chats, ${s.newLeads} new leads yesterday; ${s.waitingNow} waiting for the team, ${s.unassignedNow} unassigned now`
}

export function alertText(waiting: number, keyword: string): string {
  return `⚠️ *${waiting} chats are waiting for the team.*\nReply *${keyword}* for details.`
}

export function alertOneLine(waiting: number): string {
  return `${waiting} chats are waiting for the team now`
}

export function dueForBrief(
  m: { brief_enabled: boolean; brief_minute: number; last_brief_date: Date | null },
  local: { date: string; minutes: number },
): boolean {
  if (!m.brief_enabled) return false
  if (m.last_brief_date && m.last_brief_date.toISOString().slice(0, 10) >= local.date) return false
  return local.minutes >= m.brief_minute && local.minutes < m.brief_minute + BRIEF_LATE_MINUTES
}

export function dueForAlert(m: { alerts_enabled: boolean; last_alert_at: Date | null }, waiting: number, threshold: number, now: Date): boolean {
  if (!m.alerts_enabled || waiting < threshold) return false
  return !m.last_alert_at || now.getTime() - m.last_alert_at.getTime() >= ALERT_EVERY_MS
}

export function withinServiceWindow(lastInbound: Date | null, now: Date): boolean {
  // A minute of margin: a message sent right at the edge is refused by Meta.
  return Boolean(lastInbound && now.getTime() - lastInbound.getTime() < SERVICE_WINDOW_MS - 60_000)
}

/** Distinct {{…}} variables in a template body. */
export function templateVariableCount(body: string): number {
  return new Set([...body.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1])).size
}
