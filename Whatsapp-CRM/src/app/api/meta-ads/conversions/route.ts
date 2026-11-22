import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit } from '@/lib/rate-limit'
import { stageNames, type ConversionStage } from '@/lib/meta-ads/conversions'

const STAGES: ConversionStage[] = ['raw', 'qualified', 'won', 'lost']

/**
 * GET /api/meta-ads/conversions — results-to-Meta settings and the last 30
 * events (send log). Owner only; only this workspace; Meta ids are not
 * returned, only what the screen shows.
 */
export async function GET() {
  try {
    const ctx = await requireRole('owner')
    const [s, events, counts] = await Promise.all([
      prisma.conversionSettings.findUnique({ where: { account_id: ctx.accountId } }),
      prisma.conversionEvent.findMany({
        where: { account_id: ctx.accountId },
        orderBy: { created_at: 'desc' },
        take: 30,
        select: { id: true, target: true, channel: true, stage: true, event_name: true, status: true, attempts: true, last_error: true, created_at: true, sent_at: true },
      }),
      prisma.conversionEvent.groupBy({ by: ['status'], where: { account_id: ctx.accountId }, _count: { _all: true } }),
    ])
    return NextResponse.json({
      enabled: s?.enabled ?? true,
      stageNames: stageNames(s?.stage_names),
      crmDatasetId: s?.crm_dataset_id ?? '',
      events,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/meta-ads/conversions — body { enabled?, stageNames?, crmDatasetId?, action? }.
 * `action: 'retry'` puts this workspace's failed events back in the queue.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { enabled?: unknown; stageNames?: unknown; crmDatasetId?: unknown; action?: unknown } | null
    if (!body) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })

    if (body.action === 'retry') {
      const limited = checkRateLimit(`conversions-retry:${ctx.accountId}`, { limit: 3, windowMs: 10 * 60_000 })
      if (!limited.success) return NextResponse.json({ error: 'Retried a moment ago. Try again in a few minutes.' }, { status: 429 })
      const r = await prisma.conversionEvent.updateMany({
        where: { account_id: ctx.accountId, status: 'failed' },
        data: { status: 'pending', attempts: 0, next_attempt_at: new Date(), updated_at: new Date() },
      })
      await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'meta_conversions', fields: ['retry'], meta: { count: r.count } })
      return NextResponse.json({ retried: r.count })
    }

    const data: { enabled?: boolean; stage_names?: Record<ConversionStage, string>; crm_dataset_id?: string | null } = {}
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'On or off only.' }, { status: 400 })
      data.enabled = body.enabled
    }
    if (body.stageNames !== undefined) {
      const o = body.stageNames as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return NextResponse.json({ error: 'Stage names are not valid.' }, { status: 400 })
      for (const k of STAGES) {
        const v = o[k]
        if (typeof v !== 'string' || !v.trim() || v.trim().length > 50 || /[<>{}\u0000-\u001f]/.test(v)) {
          return NextResponse.json({ error: 'Each stage name must be 1–50 plain characters.' }, { status: 400 })
        }
      }
      data.stage_names = stageNames(o)
    }
    if (body.crmDatasetId !== undefined) {
      const v = typeof body.crmDatasetId === 'string' ? body.crmDatasetId.trim() : null
      if (v === null || (v !== '' && !/^\d{5,30}$/.test(v))) return NextResponse.json({ error: 'The dataset ID is a number from Meta Events Manager.' }, { status: 400 })
      data.crm_dataset_id = v || null
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })

    await prisma.conversionSettings.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, ...data, updated_by: ctx.userId },
      update: { ...data, updated_by: ctx.userId, updated_at: new Date() },
    })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'meta_conversions', fields: Object.keys(data) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
