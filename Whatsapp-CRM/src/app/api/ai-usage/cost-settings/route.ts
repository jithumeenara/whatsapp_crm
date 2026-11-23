import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { cleanTaxPercent, taxPercentFor } from '@/lib/ai/cost-display'
import { forgetBudget } from '@/lib/ai/budget'

/**
 * GET / PUT /api/ai-usage/cost-settings   { tax_percent: number }
 *
 * The tax on the AI provider's bill (e.g. 18% GST in India), added when
 * AI costs are shown and compared with the monthly limit (migration 200).
 * Admin only, like the Usage tab. One field, a number from 0 to 100 with
 * at most two decimals, checked here; written to the caller's own
 * workspace; audited.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json({ tax_percent: await taxPercentFor(ctx.accountId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`ai-cost-settings:${ctx.userId}`, { limit: 20, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await req.json().catch(() => null)) as { tax_percent?: unknown } | null
    const tax = cleanTaxPercent(body?.tax_percent)
    if (tax === null) {
      return NextResponse.json({ error: 'Enter a tax percentage from 0 to 100, with at most two decimals (for example 18).' }, { status: 400 })
    }
    await prisma.aiCostSettings.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, tax_percent: tax, updated_by: ctx.userId },
      update: { tax_percent: tax, updated_by: ctx.userId, updated_at: new Date() },
    })
    // The limit compares spend with tax included: re-read it next time.
    forgetBudget(ctx.accountId)
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', { area: 'ai_cost_settings', fields: ['tax_percent'], meta: { tax_percent: tax } })
    return NextResponse.json({ tax_percent: tax })
  } catch (err) {
    console.error('[ai-cost-settings] save failed:', err)
    return toErrorResponse(err)
  }
}
