/** Checks the fields of an Admin Chat member sent from the browser. */

import { DAY_KEYS } from './rules'

export class MemberFieldError extends Error {
  readonly status = 400
}

export interface MemberFields {
  scope: 'reports' | 'lookup' | 'actions'
  validFrom: Date
  validUntil: Date
  allowedDays: string[]
  startMinute: number
  endMinute: number
  briefEnabled: boolean
  briefMinute: number
  alertsEnabled: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366

export function parseMemberFields(body: Record<string, unknown>): MemberFields {
  const scope = body.scope === 'lookup' || body.scope === 'actions' ? body.scope : body.scope === 'reports' || body.scope === undefined ? 'reports' : null
  if (!scope) throw new MemberFieldError('Choose what this admin may see.')
  const from = typeof body.valid_from === 'string' && DATE.test(body.valid_from) ? new Date(`${body.valid_from}T00:00:00Z`) : null
  const until = typeof body.valid_until === 'string' && DATE.test(body.valid_until) ? new Date(`${body.valid_until}T00:00:00Z`) : null
  if (!from || !until || Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) throw new MemberFieldError('Choose the first and last day.')
  if (until < from) throw new MemberFieldError('The last day is before the first day.')
  if ((until.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) throw new MemberFieldError('Access can last at most a year; renew it after that.')
  const days = Array.isArray(body.allowed_days) ? body.allowed_days.filter((d): d is string => typeof d === 'string' && (DAY_KEYS as readonly string[]).includes(d)) : []
  if (days.length === 0) throw new MemberFieldError('Choose at least one day.')
  const start = Number(body.start_minute)
  const end = Number(body.end_minute)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end) {
    throw new MemberFieldError('The start time must be before the end time.')
  }
  const briefMinute = body.brief_minute === undefined ? 540 : Number(body.brief_minute)
  if (!Number.isInteger(briefMinute) || briefMinute < 0 || briefMinute > 1439) throw new MemberFieldError('Choose a time for the daily brief.')
  const briefEnabled = body.brief_enabled === true
  if (briefEnabled && (briefMinute < start || briefMinute >= end)) {
    throw new MemberFieldError('The daily brief time must be inside their allowed hours.')
  }
  return {
    scope,
    validFrom: from,
    validUntil: until,
    allowedDays: [...new Set(days)],
    startMinute: start,
    endMinute: end,
    briefEnabled,
    briefMinute,
    alertsEnabled: body.alerts_enabled === true,
  }
}
