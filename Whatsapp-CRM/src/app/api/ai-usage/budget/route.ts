import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiBudgetState, forgetBudget, MAX_LIMIT_USD, WARN_RATIO } from '@/lib/ai/budget'

/**
 * GET    /api/ai-usage/budget            this month's limit and spend
 * PUT    /api/ai-usage/budget  { monthly_limit_usd: number }   set or change it
 * DELETE /api/ai-usage/budget            remove the limit
 *
 * Spending is admin business, like the Usage tab. Only the one number is
 * taken from the body; the month and notices are the server's.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const s = await aiBudgetState(ctx.accountId)
    return NextResponse.json({
      monthly_limit_usd: s.limitUsd,
      spent_usd: Math.round(s.spentUsd * 100) / 100,
      month: s.month,
      ratio: s.ratio,
      over: s.over,
      warn_ratio: WARN_RATIO,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`ai-budget:${ctx.userId}`, { limit: 20, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await req.json().catch(() => null)) as { monthly_limit_usd?: unknown } | null
    const raw = body?.monthly_limit_usd
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(value) || value < 1 || value > MAX_LIMIT_USD) {
      return NextResponse.json({ error: `Enter a monthly limit between $1 and $${MAX_LIMIT_USD.toLocaleString('en-US')}.` }, { status: 400 })
    }
    const usd = Math.round(value * 100) / 100

    const before = await prisma.aiBudget.findUnique({ where: { account_id: ctx.accountId }, select: { monthly_limit_usd: true } })
    // A new or higher limit starts its notices again for this month: an
    // admin who raised it wants to hear when the new one is reached.
    await prisma.aiBudget.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, monthly_limit_usd: usd, updated_by: ctx.userId },
      update: { monthly_limit_usd: usd, updated_by: ctx.userId, updated_at: new Date(), warned_month: null, stopped_month: null },
    })
    forgetBudget(ctx.accountId)
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', {
      area: 'ai_budget',
      fields: ['monthly_limit_usd'],
      meta: { had_limit: Boolean(before) },
    })
    const s = await aiBudgetState(ctx.accountId)
    return NextResponse.json({ monthly_limit_usd: s.limitUsd, spent_usd: Math.round(s.spentUsd * 100) / 100, month: s.month, ratio: s.ratio, over: s.over, warn_ratio: WARN_RATIO })
  } catch (err) {
    console.error('[ai-budget] save failed:', err)
    return toErrorResponse(err)
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const removed = await prisma.aiBudget.deleteMany({ where: { account_id: ctx.accountId } })
    forgetBudget(ctx.accountId)
    if (removed.count > 0) {
      await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', { area: 'ai_budget', fields: ['monthly_limit_usd'], meta: { removed: true } })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
