import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { GOAL_METRICS, METRICS, validateGoal } from '@/lib/reports/goals/rules'
import { loadScheduleTeam } from '@/lib/reports/schedule/team'

const MAX_GOALS = 100
const GOAL_FIELDS = { id: true, metric: true, period: true, target: true, user_id: true, created_at: true } as const

/** GET /api/reports/goals — this business's goals, the metrics and the team (names only). Owners and admins. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const [goals, team] = await Promise.all([
      prisma.reportGoal.findMany({ where: { account_id: ctx.accountId }, orderBy: { created_at: 'asc' }, select: GOAL_FIELDS }),
      loadScheduleTeam(ctx.accountId),
    ])
    return NextResponse.json({
      goals: goals.map((g) => ({ ...g, target: Number(g.target) })),
      metrics: GOAL_METRICS.map((k) => ({ key: k, label: METRICS[k].label, kind: METRICS[k].kind })),
      team: team.members.map((m) => ({ id: m.id, name: m.name, role: m.role })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/reports/goals — add a goal. One per metric, period and person (or team). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const team = await loadScheduleTeam(ctx.accountId)
    const v = validateGoal(await req.json().catch(() => null), team.roles)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    if ((await prisma.reportGoal.count({ where: { account_id: ctx.accountId } })) >= MAX_GOALS) {
      return NextResponse.json({ error: `Up to ${MAX_GOALS} goals per business.` }, { status: 400 })
    }
    try {
      const row = await prisma.reportGoal.create({ data: { ...v.value, account_id: ctx.accountId, created_by: ctx.userId }, select: GOAL_FIELDS })
      await audit(auditCtx(req, ctx), { action: 'record.created', target: { type: 'report_goal', id: row.id, label: METRICS[v.value.metric].label }, after: { ...v.value } })
      return NextResponse.json({ goal: { ...row, target: Number(row.target) } })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'There is already a goal for this, for the same period and person. Change that one instead.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
