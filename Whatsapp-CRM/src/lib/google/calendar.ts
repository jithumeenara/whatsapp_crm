/**
 * Google Calendar — the business calendar.
 *
 *  - The assistant books appointments: free slots come from the business's
 *    working days and hours minus what is already busy on the calendar
 *    (freeBusy), and a booking is a follow-up plus an event, with a Google
 *    Meet link when switched on.
 *  - Follow-ups and tasks are written to the calendar every 5 minutes, and
 *    a time changed or an event cancelled in Calendar comes back.
 *
 * Times are the business's own (rule 10): slots are built in its zone,
 * events carry it, and nothing reads the server's clock as local time.
 */

import { prisma } from '@/lib/db'
import { isPlaceholderPhone } from '@/lib/contacts/validate'
import { localDate, zonedInstant } from '@/lib/agents/zoned-time'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { ensureGoogleTables } from './store'
import { disabledApi, disabledApiMessage, isApiDisabled } from './api-disabled'

const API = 'https://www.googleapis.com/calendar/v3'

export interface CalendarSettings {
  calendarId: string
  slotMinutes: number
  daysAhead: number
  dayStart: string
  dayEnd: string
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[]
  /** Hours from now before the first bookable slot. */
  leadHours: number
  meet: boolean
  booking: boolean
  syncFollowUps: boolean
  syncTasks: boolean
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  calendarId: 'primary',
  slotMinutes: 30,
  daysAhead: 14,
  dayStart: '09:00',
  dayEnd: '18:00',
  workDays: [1, 2, 3, 4, 5, 6],
  leadHours: 2,
  meet: true,
  booking: true,
  syncFollowUps: true,
  syncTasks: true,
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Stored settings, each value checked and defaulted — never trusted raw. */
export function parseCalendarSettings(raw: unknown): CalendarSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_CALENDAR_SETTINGS
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  const start = typeof r.dayStart === 'string' && HHMM.test(r.dayStart) ? r.dayStart : d.dayStart
  const end = typeof r.dayEnd === 'string' && HHMM.test(r.dayEnd) && r.dayEnd > start ? r.dayEnd : d.dayEnd
  const days = Array.isArray(r.workDays)
    ? [...new Set(r.workDays.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
    : d.workDays
  return {
    calendarId: typeof r.calendarId === 'string' && /^[\w.@+-]{1,200}$/.test(r.calendarId) ? r.calendarId : d.calendarId,
    slotMinutes: [15, 20, 30, 45, 60, 90, 120].includes(r.slotMinutes as number) ? (r.slotMinutes as number) : d.slotMinutes,
    daysAhead: num(r.daysAhead, 1, 60, d.daysAhead),
    dayStart: start,
    dayEnd: end,
    workDays: days.length ? days : d.workDays,
    leadHours: num(r.leadHours, 0, 72, d.leadHours),
    meet: bool(r.meet, d.meet),
    booking: bool(r.booking, d.booking),
    syncFollowUps: bool(r.syncFollowUps, d.syncFollowUps),
    syncTasks: bool(r.syncTasks, d.syncTasks),
  }
}

export class CalendarError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'CalendarError'
  }
}

async function cal<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new CalendarError(`Could not reach Google Calendar: ${err instanceof Error ? err.message : String(err)}`, 0)
  }
  if (res.status === 204) return {} as T
  if (res.ok) return (await res.json().catch(() => ({}))) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Google Calendar returned ${res.status}`
  if (isApiDisabled(msg)) {
    throw new CalendarError(disabledApiMessage(disabledApi(msg, 'Google Calendar API')), res.status)
  }
  throw new CalendarError(msg, res.status)
}

export async function loadCalendar(accountId: string): Promise<{ settings: CalendarSettings; timezone: string } | null> {
  if (!(await isGoogleServiceEnabled(accountId, 'calendar'))) return null
  const conn = await prisma.googleConnection.findUnique({ where: { account_id: accountId }, select: { calendar_settings: true } })
  const { businessTimezone } = await import('@/lib/ai/human-date')
  return { settings: parseCalendarSettings(conn?.calendar_settings), timezone: await businessTimezone(accountId) }
}

/** Whether the assistant may offer and book appointments. */
export async function calendarBookingEnabled(accountId: string): Promise<boolean> {
  const c = await loadCalendar(accountId).catch(() => null)
  return Boolean(c?.settings.booking)
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function hhmmOf(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/** Every candidate slot start in the window, before busy time is removed. */
export function candidateSlots(settings: CalendarSettings, timezone: string, now: Date, days = settings.daysAhead): Date[] {
  const today = localDate(timezone, now)
  if (!today) return []
  const earliest = now.getTime() + settings.leadHours * 3600_000
  const out: Date[] = []
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i)
    if (!settings.workDays.includes(weekdayOf(day))) continue
    for (let m = minutesOf(settings.dayStart); m + settings.slotMinutes <= minutesOf(settings.dayEnd); m += settings.slotMinutes) {
      const at = zonedInstant(timezone, day, hhmmOf(m))
      if (at && at.getTime() >= earliest) out.push(at)
    }
  }
  return out
}

export function slotLabel(at: Date, timezone: string): string {
  return at.toLocaleString('en-IN', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Free slots: candidates minus anything busy on the calendar. */
export async function freeSlots(accountId: string, opts: { days?: number; limit?: number } = {}): Promise<Array<{ start: string; label: string }>> {
  const c = await loadCalendar(accountId)
  if (!c) throw new CalendarError('Google Calendar is not connected.', 400)
  const now = new Date()
  const candidates = candidateSlots(c.settings, c.timezone, now, Math.min(opts.days ?? c.settings.daysAhead, c.settings.daysAhead))
  if (candidates.length === 0) return []
  const token = await googleAccessToken(accountId)
  const end = new Date(candidates[candidates.length - 1].getTime() + c.settings.slotMinutes * 60_000)
  const fb = await cal<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: candidates[0].toISOString(), timeMax: end.toISOString(), items: [{ id: c.settings.calendarId }] }),
  })
  const busy = Object.values(fb.calendars ?? {}).flatMap((x) => x.busy ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
  const len = c.settings.slotMinutes * 60_000
  return candidates
    .filter((s) => !busy.some(([bs, be]) => s.getTime() < be && s.getTime() + len > bs))
    .slice(0, opts.limit ?? 40)
    .map((s) => ({ start: s.toISOString(), label: slotLabel(s, c.timezone) }))
}

interface EventInput {
  summary: string
  description?: string
  start: Date
  minutes: number
  timezone: string
  meet?: boolean
  privateProps: Record<string, string>
}

function eventBody(e: EventInput, requestId?: string): Record<string, unknown> {
  return {
    summary: e.summary.slice(0, 250),
    description: e.description?.slice(0, 4000),
    start: { dateTime: e.start.toISOString(), timeZone: e.timezone },
    end: { dateTime: new Date(e.start.getTime() + e.minutes * 60_000).toISOString(), timeZone: e.timezone },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    extendedProperties: { private: { crm: '1', ...e.privateProps } },
    ...(e.meet && requestId ? { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  }
}

export async function createEvent(accountId: string, calendarId: string, e: EventInput, requestId: string): Promise<{ id: string; meetLink: string | null }> {
  const token = await googleAccessToken(accountId)
  const res = await cal<{ id?: string; hangoutLink?: string }>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=${e.meet ? 1 : 0}&sendUpdates=none`,
    { method: 'POST', body: JSON.stringify(eventBody(e, requestId)) },
  )
  if (!res.id) throw new CalendarError('Google did not return the new event.', 500)
  return { id: res.id, meetLink: res.hangoutLink ?? null }
}

/**
 * The assistant's booking: checked against the calendar again at the
 * moment of booking (someone may have taken the slot since it was
 * offered), then a follow-up for the team and an event with Meet.
 */
export async function bookAppointment(args: {
  accountId: string
  userId: string
  contactId: string | null
  contactName: string | null
  contactPhone: string | null
  slotStart: string
  purpose: string | null
}): Promise<{ ok: true; label: string; meetLink: string | null; followUpId: string } | { ok: false; reason: string }> {
  const c = await loadCalendar(args.accountId)
  if (!c || !c.settings.booking) return { ok: false, reason: 'Booking through the calendar is switched off.' }
  const at = new Date(args.slotStart)
  if (Number.isNaN(at.getTime())) return { ok: false, reason: 'That is not one of the offered times.' }
  const free = await freeSlots(args.accountId, { limit: 1000 })
  if (!free.some((s) => Date.parse(s.start) === at.getTime())) {
    return { ok: false, reason: 'That time is no longer free. Offer the next free times.' }
  }
  const who = args.contactName?.trim() || args.contactPhone || 'Customer'
  const followUp = await prisma.followUp.create({
    data: {
      account_id: args.accountId,
      user_id: args.userId,
      contact_id: args.contactId,
      title: `Appointment: ${who}`,
      note: [args.purpose?.trim(), args.contactPhone ? `Phone: ${args.contactPhone}` : null, 'Booked by the assistant'].filter(Boolean).join('\n'),
      due_at: at,
    },
  })
  try {
    const ev = await createEvent(
      args.accountId,
      c.settings.calendarId,
      {
        summary: `Appointment: ${who}`,
        description: followUp.note ?? undefined,
        start: at,
        minutes: c.settings.slotMinutes,
        timezone: c.timezone,
        meet: c.settings.meet,
        privateProps: { crm_followup: followUp.id },
      },
      followUp.id,
    )
    await prisma.followUp.update({
      where: { id: followUp.id },
      data: { google_event_id: ev.id, google_meet_link: ev.meetLink, google_synced_at: new Date() },
    })
    return { ok: true, label: slotLabel(at, c.timezone), meetLink: ev.meetLink, followUpId: followUp.id }
  } catch (err) {
    // The follow-up stands; the sync will try the event again.
    console.error('[calendar] booking event failed:', err instanceof Error ? err.message : err)
    return { ok: true, label: slotLabel(at, c.timezone), meetLink: null, followUpId: followUp.id }
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────

/** Ten seconds of slack: writing google_synced_at also moves updated_at. */
const SYNC_SLACK_MS = 10_000
const BATCH = 25

async function syncFollowUps(accountId: string, settings: CalendarSettings, timezone: string): Promise<void> {
  const token = await googleAccessToken(accountId)
  const base = `/calendars/${encodeURIComponent(settings.calendarId)}/events`
  const now = new Date()

  // 1. New follow-ups onto the calendar.
  const fresh = await prisma.followUp.findMany({
    where: {
      account_id: accountId,
      status: 'pending',
      google_event_id: null,
      due_at: { gte: new Date(now.getTime() - 3600_000), lte: new Date(now.getTime() + 60 * 86400_000) },
    },
    include: { contact: { select: { name: true, phone: true } } },
    orderBy: { due_at: 'asc' },
    take: BATCH,
  })
  for (const f of fresh) {
    const phone = f.contact?.phone && !isPlaceholderPhone(f.contact.phone) ? f.contact.phone : null
    const ev = await cal<{ id?: string }>(token, `${base}?sendUpdates=none`, {
      method: 'POST',
      body: JSON.stringify(
        eventBody({
          summary: f.title,
          description: [f.note, f.contact?.name ? `Contact: ${f.contact.name}` : null, phone ? `Phone: ${phone}` : null].filter(Boolean).join('\n'),
          start: f.due_at,
          minutes: settings.slotMinutes,
          timezone,
          privateProps: { crm_followup: f.id },
        }),
      ),
    }).catch((err) => {
      console.error('[calendar] could not add a follow-up:', err instanceof Error ? err.message : err)
      return null
    })
    if (ev?.id) await prisma.followUp.update({ where: { id: f.id }, data: { google_event_id: ev.id, google_synced_at: new Date() } })
  }

  // 2. Changed in the CRM since the last sync: moved, done or skipped.
  const changed = await prisma.followUp.findMany({
    where: { account_id: accountId, google_event_id: { not: null } },
    select: { id: true, title: true, note: true, due_at: true, status: true, google_event_id: true, google_synced_at: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
    take: 100,
  })
  for (const f of changed.filter((x) => !x.google_synced_at || x.updated_at.getTime() - x.google_synced_at.getTime() > SYNC_SLACK_MS).slice(0, BATCH)) {
    try {
      if (f.status !== 'pending') {
        await cal(token, `${base}/${encodeURIComponent(f.google_event_id!)}?sendUpdates=none`, { method: 'DELETE' }).catch((err) => {
          if (!(err instanceof CalendarError && (err.status === 404 || err.status === 410))) throw err
        })
        await prisma.followUp.update({ where: { id: f.id }, data: { google_event_id: null, google_synced_at: new Date() } })
      } else {
        await cal(token, `${base}/${encodeURIComponent(f.google_event_id!)}?sendUpdates=none`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: f.title.slice(0, 250),
            start: { dateTime: f.due_at.toISOString(), timeZone: timezone },
            end: { dateTime: new Date(f.due_at.getTime() + settings.slotMinutes * 60_000).toISOString(), timeZone: timezone },
          }),
        })
        await prisma.followUp.update({ where: { id: f.id }, data: { google_synced_at: new Date() } })
      }
    } catch (err) {
      console.error('[calendar] could not update an event:', err instanceof Error ? err.message : err)
    }
  }

  // 3. Changed in Calendar: a new time, or cancelled. Oldest-checked first,
  //    a batch per run, so every event is looked at in turn.
  const watched = await prisma.followUp.findMany({
    where: { account_id: accountId, status: 'pending', google_event_id: { not: null } },
    select: { id: true, due_at: true, note: true, google_event_id: true },
    orderBy: { google_synced_at: 'asc' },
    take: BATCH,
  })
  for (const f of watched) {
    try {
      const ev = await cal<{ status?: string; start?: { dateTime?: string } }>(token, `${base}/${encodeURIComponent(f.google_event_id!)}`)
      if (ev.status === 'cancelled') {
        await prisma.followUp.update({
          where: { id: f.id },
          data: { status: 'skipped', note: [f.note, 'Cancelled in Google Calendar'].filter(Boolean).join('\n'), google_event_id: null, google_synced_at: new Date() },
        })
        continue
      }
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null
      const moved = start && Math.abs(start.getTime() - f.due_at.getTime()) > 60_000
      await prisma.followUp.update({ where: { id: f.id }, data: { ...(moved ? { due_at: start } : {}), google_synced_at: new Date() } })
    } catch (err) {
      if (err instanceof CalendarError && (err.status === 404 || err.status === 410)) {
        await prisma.followUp.update({
          where: { id: f.id },
          data: { status: 'skipped', note: [f.note, 'Deleted from Google Calendar'].filter(Boolean).join('\n'), google_event_id: null, google_synced_at: new Date() },
        })
      } else {
        console.error('[calendar] could not read an event:', err instanceof Error ? err.message : err)
      }
    }
  }
}

async function syncTasks(accountId: string, settings: CalendarSettings): Promise<void> {
  const token = await googleAccessToken(accountId)
  const base = `/calendars/${encodeURIComponent(settings.calendarId)}/events`
  const allDay = (d: Date) => {
    const day = d.toISOString().slice(0, 10)
    return { start: { date: day }, end: { date: addDays(day, 1) } }
  }

  const fresh = await prisma.task.findMany({
    where: { account_id: accountId, google_event_id: null, due_date: { not: null }, status: { in: ['todo', 'in_progress'] } },
    select: { id: true, title: true, description: true, due_date: true },
    take: BATCH,
  })
  for (const t of fresh) {
    const ev = await cal<{ id?: string }>(token, `${base}?sendUpdates=none`, {
      method: 'POST',
      body: JSON.stringify({
        summary: `Task: ${t.title}`.slice(0, 250),
        description: t.description?.slice(0, 4000),
        ...allDay(t.due_date!),
        extendedProperties: { private: { crm: '1', crm_task: t.id } },
      }),
    }).catch(() => null)
    if (ev?.id) await prisma.task.update({ where: { id: t.id }, data: { google_event_id: ev.id, google_synced_at: new Date() } })
  }

  const changed = await prisma.task.findMany({
    where: { account_id: accountId, google_event_id: { not: null } },
    select: { id: true, title: true, status: true, due_date: true, google_event_id: true, google_synced_at: true, updated_at: true },
    orderBy: { updated_at: 'desc' },
    take: 100,
  })
  for (const t of changed.filter((x) => !x.google_synced_at || x.updated_at.getTime() - x.google_synced_at.getTime() > SYNC_SLACK_MS).slice(0, BATCH)) {
    try {
      if (t.status === 'done' || t.status === 'cancelled' || !t.due_date) {
        await cal(token, `${base}/${encodeURIComponent(t.google_event_id!)}?sendUpdates=none`, { method: 'DELETE' }).catch(() => {})
        await prisma.task.update({ where: { id: t.id }, data: { google_event_id: null, google_synced_at: new Date() } })
      } else {
        await cal(token, `${base}/${encodeURIComponent(t.google_event_id!)}?sendUpdates=none`, {
          method: 'PATCH',
          body: JSON.stringify({ summary: `Task: ${t.title}`.slice(0, 250), ...allDay(t.due_date) }),
        })
        await prisma.task.update({ where: { id: t.id }, data: { google_synced_at: new Date() } })
      }
    } catch (err) {
      console.error('[calendar] could not update a task event:', err instanceof Error ? err.message : err)
    }
  }
}

/** Every 5 minutes from server.ts. */
export async function sweepGoogleCalendars(): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const conns = await prisma.googleConnection
    .findMany({ where: { status: 'connected', enabled_services: { has: 'calendar' } }, select: { account_id: true } })
    .catch(() => [])
  for (const { account_id } of conns) {
    try {
      const c = await loadCalendar(account_id)
      if (!c) continue
      if (c.settings.syncFollowUps) await syncFollowUps(account_id, c.settings, c.timezone)
      if (c.settings.syncTasks) await syncTasks(account_id, c.settings)
    } catch (err) {
      console.error('[calendar] sync failed:', err instanceof Error ? err.message : err)
    }
  }
}
