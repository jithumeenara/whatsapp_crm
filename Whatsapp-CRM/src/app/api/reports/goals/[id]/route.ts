import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { METRICS, validateGoal, type GoalMetric } from '@/lib/reports/goals/rules'
import { loadScheduleTeam } from '@/lib/reports/schedule/team'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = () => NextResponse.json({ error: 'There is no such goal.' }, { status: 404 })

/** PATCH /api/reports/goals/[id] — change a goal of this business. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const { id } = await params
    if (!UUID.test(id)) return NOT_FOUND()
    const existing = await prisma.reportGoal.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NOT_FOUND()
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const merged = { metric: existing.metric, period: existing.period, target: Number(existing.target), user_id: existing.user_id, ...(body && typeof body === 'object' ? body : {}) }
    const team = await loadScheduleTeam(ctx.accountId)
    const v = validateGoal(merged, team.roles)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    try {
      const res = await prisma.reportGoal.updateMany({ where: { id, account_id: ctx.accountId }, data: v.value })
      if (res.count === 0) return NOT_FOUND()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'There is already a goal for this, for the same period and person.' }, { status: 409 })
      }
      throw err
    }
    await audit(auditCtx(req, ctx), {
      action: 'record.updated',
      target: { type: 'report_goal', id, label: METRICS[v.value.metric].label },
      before: { metric: existing.metric, period: existing.period, target: Number(existing.target), user_id: existing.user_id },
      after: { ...v.value },
    })
    return NextResponse.json({ goal: { id, ...v.value } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/reports/goals/[id] — remove a goal of this business. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const { id } = await params
    if (!UUID.test(id)) return NOT_FOUND()
    const existing = await prisma.reportGoal.findFirst({ where: { id, account_id: ctx.accountId }, select: { metric: true } })
    if (!existing) return NOT_FOUND()
    await prisma.reportGoal.deleteMany({ where: { id, account_id: ctx.accountId } })
    await audit(auditCtx(req, ctx), { action: 'record.deleted', target: { type: 'report_goal', id, label: METRICS[existing.metric as GoalMetric]?.label ?? existing.metric } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
