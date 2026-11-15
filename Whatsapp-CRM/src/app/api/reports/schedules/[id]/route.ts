import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { findReport } from '@/lib/reports/doc/registry'
import { loadScheduleTeam, SCHEDULE_FIELDS } from '@/lib/reports/schedule/team'
import { validateSchedule } from '@/lib/reports/schedule/validate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH /api/reports/schedules/[id] — change one of this business's schedules. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    const existing = await prisma.scheduledReport.findFirst({ where: { id, account_id: ctx.accountId }, select: SCHEDULE_FIELDS })
    if (!existing) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    // Whatever is not sent stays as it was; the whole result is checked again.
    const merged = { ...existing, ...(body && typeof body === 'object' ? body : {}) }
    const team = await loadScheduleTeam(ctx.accountId)
    const v = validateSchedule(merged, team.roles)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const res = await prisma.scheduledReport.updateMany({ where: { id, account_id: ctx.accountId }, data: v.value })
    if (res.count === 0) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    const row = await prisma.scheduledReport.findFirst({ where: { id, account_id: ctx.accountId }, select: SCHEDULE_FIELDS })
    await audit(auditCtx(req, ctx), {
      action: existing.enabled !== v.value.enabled ? 'record.status_changed' : 'record.updated',
      target: { type: 'scheduled_report', id, label: findReport(v.value.report_key)?.title ?? v.value.report_key },
      before: { ...existing, recipient_ids: undefined, recipients: existing.recipient_ids.length },
      after: { ...v.value, recipient_ids: undefined, recipients: v.value.recipient_ids.length },
    })
    return NextResponse.json({ schedule: row })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/reports/schedules/[id] — remove one of this business's schedules. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    const existing = await prisma.scheduledReport.findFirst({ where: { id, account_id: ctx.accountId }, select: { report_key: true } })
    if (!existing) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    await prisma.scheduledReport.deleteMany({ where: { id, account_id: ctx.accountId } })
    await audit(auditCtx(req, ctx), {
      action: 'record.deleted',
      target: { type: 'scheduled_report', id, label: findReport(existing.report_key)?.title ?? existing.report_key },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
