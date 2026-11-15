/**
 * A scheduled report from the request body: each field copied and checked
 * on its own (never `data: body`), recipients only from this team and only
 * people who may see that report for the whole team. Pure.
 */

import { FREQUENCIES, recipientMayGet, SCHEDULABLE, type Frequency } from './rules'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_RECIPIENTS = 50

export interface ScheduleInput {
  report_key: string
  frequency: Frequency
  day: number
  send_hour: number
  recipient_ids: string[]
  by_chat: boolean
  by_email: boolean
  enabled: boolean
}

type Result = { ok: true; value: ScheduleInput } | { ok: false; error: string }

/** `team`: user id → role, for this account's members. */
export function validateSchedule(body: unknown, team: Map<string, string>): Result {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const report_key = typeof b.report_key === 'string' ? b.report_key : ''
  if (!SCHEDULABLE.includes(report_key)) return { ok: false, error: 'Choose a report to send.' }
  const frequency = b.frequency as Frequency
  if (!FREQUENCIES.includes(frequency)) return { ok: false, error: 'Choose daily, weekly or monthly.' }
  const send_hour = Number(b.send_hour)
  if (!Number.isInteger(send_hour) || send_hour < 0 || send_hour > 23) return { ok: false, error: 'Choose an hour between 0 and 23.' }
  let day = Number(b.day)
  if (frequency === 'daily') day = 1
  else if (frequency === 'weekly' && !(Number.isInteger(day) && day >= 1 && day <= 7)) return { ok: false, error: 'Choose a day of the week.' }
  else if (frequency === 'monthly' && !(Number.isInteger(day) && day >= 1 && day <= 28)) return { ok: false, error: 'Choose a day of the month between 1 and 28.' }

  const raw = Array.isArray(b.recipient_ids) ? b.recipient_ids : []
  const recipient_ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  if (!recipient_ids.length || recipient_ids.length !== new Set(raw).size) return { ok: false, error: 'Choose who should get it, from your team.' }
  if (recipient_ids.length > MAX_RECIPIENTS) return { ok: false, error: `Up to ${MAX_RECIPIENTS} people per schedule.` }
  for (const id of recipient_ids) {
    const role = team.get(id)
    if (!role) return { ok: false, error: 'Someone on the list is not on this team.' }
    if (!recipientMayGet(report_key, role)) return { ok: false, error: 'Someone on the list may not see this report.' }
  }

  const by_chat = b.by_chat === true
  const by_email = b.by_email === true
  if (!by_chat && !by_email) return { ok: false, error: 'Choose WhatsApp/Telegram, email, or both.' }
  return { ok: true, value: { report_key, frequency, day, send_hour, recipient_ids, by_chat, by_email, enabled: b.enabled !== false } }
}
