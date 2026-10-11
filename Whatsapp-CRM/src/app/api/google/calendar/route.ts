import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import { CalendarError, freeSlots, parseCalendarSettings } from '@/lib/google/calendar'
import { isGoogleServiceEnabled, loadGoogleConnection, logGoogleActivity } from '@/lib/google/oauth'

/** The Calendar card's settings, and the business zone they are read in. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    const row = conn
      ? await prisma.googleConnection.findUnique({ where: { id: conn.id }, select: { calendar_settings: true } })
      : null
    const [synced, timezone] = await Promise.all([
      prisma.followUp.count({ where: { account_id: ctx.accountId, google_event_id: { not: null } } }).catch(() => 0),
      businessTimezone(ctx.accountId),
    ])
    return NextResponse.json({ settings: parseCalendarSettings(row?.calendar_settings), timezone, synced })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Saves the settings; what is saved is what comes back, checked. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn) return NextResponse.json({ error: 'Connect a Google account first.' }, { status: 400 })
    const body = (await req.json().catch(() => ({}))) as { settings?: unknown }
    const settings = parseCalendarSettings(body.settings)
    await prisma.googleConnection.update({ where: { id: conn.id }, data: { calendar_settings: settings as object } })
    await logGoogleActivity(ctx.accountId, ctx.userId, 'calendar_settings', `${settings.slotMinutes}-minute slots, ${settings.dayStart}–${settings.dayEnd}`)
    return NextResponse.json({ ok: true, settings })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** The next free times, as the assistant would offer them — a live test. */
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    if (!(await isGoogleServiceEnabled(ctx.accountId, 'calendar'))) {
      return NextResponse.json({ error: 'Turn on Google Calendar first.' }, { status: 400 })
    }
    const slots = await freeSlots(ctx.accountId, { limit: 6 })
    return NextResponse.json({ slots })
  } catch (err) {
    if (err instanceof CalendarError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    }
    return toErrorResponse(err)
  }
}
