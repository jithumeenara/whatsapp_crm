import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { findReport } from '@/lib/reports/doc/registry'
import { SCHEDULABLE } from '@/lib/reports/schedule/rules'
import { loadScheduleTeam, SCHEDULE_FIELDS } from '@/lib/reports/schedule/team'
import { validateSchedule } from '@/lib/reports/schedule/validate'

/** Most schedules one business may have. */
const MAX_SCHEDULES = 50

/**
 * GET /api/reports/schedules — this business's scheduled reports, the
 * reports that can be scheduled, and the team (name, role, reachable by
 * Admin Chat / email; never the number or address). Owners and admins.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const [schedules, team] = await Promise.all([
      prisma.scheduledReport.findMany({ where: { account_id: ctx.accountId }, orderBy: { created_at: 'asc' }, select: SCHEDULE_FIELDS }),
      loadScheduleTeam(ctx.accountId),
    ])
    const reports = SCHEDULABLE.map((key) => ({ key, title: findReport(key)?.title ?? key }))
    return NextResponse.json({ schedules, reports, team: team.members })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/reports/schedules — add one. Fields copied and checked one by one. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const body = await req.json().catch(() => null)
    const team = await loadScheduleTeam(ctx.accountId)
    const v = validateSchedule(body, team.roles)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const count = await prisma.scheduledReport.count({ where: { account_id: ctx.accountId } })
    if (count >= MAX_SCHEDULES) return NextResponse.json({ error: `Up to ${MAX_SCHEDULES} scheduled reports per business.` }, { status: 400 })
    const row = await prisma.scheduledReport.create({
      data: { ...v.value, account_id: ctx.accountId, created_by: ctx.userId },
      select: SCHEDULE_FIELDS,
    })
    await audit(auditCtx(req, ctx), {
      action: 'record.created',
      target: { type: 'scheduled_report', id: row.id, label: findReport(row.report_key)?.title ?? row.report_key },
      after: { ...v.value, recipients: v.value.recipient_ids.length },
    })
    return NextResponse.json({ schedule: row })
  } catch (err) {
    return toErrorResponse(err)
  }
}
