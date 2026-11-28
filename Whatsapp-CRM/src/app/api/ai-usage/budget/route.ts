import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiBudgetState, forgetBudget, MAX_LIMIT_USD, WARN_RATIO, type BudgetState } from '@/lib/ai/budget'
import { cleanCurrency, suggestedUsdRate, SUGGESTED_RATES_AS_OF } from '@/lib/ai/fx'
import { liveUsdRate } from '@/lib/ai/fx-live'

/**
 * GET    /api/ai-usage/budget            this month's limit and spend, in the business currency
 * PUT    /api/ai-usage/budget  { amount: number, usd_rate: number }   set or change it
 * DELETE /api/ai-usage/budget            remove the limit
 *
 * AI is billed in USD; the business sees and enters its limit in its own
 * currency (accounts.default_currency, Business profile). The currency is
 * always the server's, never the body's; the admin confirms the rate
 * (1 USD = usd_rate), and the limit is enforced in USD = amount / rate.
 * Admin only, like the Usage tab; audited.
 */

export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

async function businessCurrency(accountId: string): Promise<string> {
  const a = await prisma.account.findUnique({ where: { id: accountId }, select: { default_currency: true } })
  return cleanCurrency(a?.default_currency)
}

function view(s: BudgetState, currency: string, live: { rate: number; fetchedAt: Date } | null) {
  // The limit's own rate when it was set in today's business currency
  // (live when it follows the market); otherwise today's live rate, then a
  // built-in suggestion (no limit yet, or the business changed currency).
  const ownRate = s.currency === currency && s.usdRate ? s.usdRate : null
  const rate = ownRate ?? live?.rate ?? suggestedUsdRate(currency)
  const source = ownRate ? (s.rateAuto && s.rateFetchedAt ? 'live' : 'saved') : live ? 'live' : 'suggested'
  const fetchedAt = ownRate ? s.rateFetchedAt ?? null : live?.fetchedAt ?? null
  const toLocal = (usd: number) => (rate ? round2(usd * rate) : null)
  return {
    currency,
    usd_rate: rate,
    rate_source: source,
    rate_fetched_at: fetchedAt ? fetchedAt.toISOString() : null,
    // A new limit follows the market by default; an existing one keeps its choice.
    rate_auto: s.limitUsd === null ? true : s.rateAuto === true,
    rate_is_suggested: source === 'suggested',
    rates_as_of: SUGGESTED_RATES_AS_OF,
    // As entered when it was set in today's currency; converted otherwise.
    limit_amount: s.limitUsd === null ? null : s.currency === currency && s.limitAmount ? s.limitAmount : toLocal(s.limitUsd),
    spent_amount: toLocal(s.spentUsd),
    monthly_limit_usd: s.limitUsd,
    spent_usd: round2(s.spentUsd),
    month: s.month,
    ratio: s.ratio,
    over: s.over,
    warn_ratio: WARN_RATIO,
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const [s, currency] = await Promise.all([aiBudgetState(ctx.accountId), businessCurrency(ctx.accountId)])
    return NextResponse.json(view(s, currency, await liveUsdRate(currency)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`ai-budget:${ctx.userId}`, { limit: 20, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await req.json().catch(() => null)) as { amount?: unknown; usd_rate?: unknown; rate_auto?: unknown } | null
    if (body?.rate_auto !== undefined && typeof body.rate_auto !== 'boolean') {
      return NextResponse.json({ error: 'rate_auto must be true or false.' }, { status: 400 })
    }
    const rateAuto = body?.rate_auto === true
    const amount = num(body?.amount)
    const currency = await businessCurrency(ctx.accountId)
    // Following the market: today's live rate, falling back to the rate the
    // admin typed, then the built-in suggestion. Otherwise the typed rate.
    const live = rateAuto ? await liveUsdRate(currency) : null
    const typed = num(body?.usd_rate)
    const rate = live?.rate ?? (Number.isFinite(typed) ? typed : rateAuto ? suggestedUsdRate(currency) ?? NaN : NaN)
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1_000_000) {
      return NextResponse.json({ error: 'Enter how much 1 US dollar is in your currency (a number above 0).' }, { status: 400 })
    }
    const usd = Number.isFinite(amount) ? round2(amount / rate) : NaN
    if (!Number.isFinite(amount) || amount <= 0 || !(usd >= 0.01) || usd > MAX_LIMIT_USD) {
      return NextResponse.json({ error: 'Enter a monthly limit above 0 (at most the same as $100,000).' }, { status: 400 })
    }
    const usdRate = Math.round(rate * 1_000_000) / 1_000_000
    const limitAmount = round2(amount)

    const before = await prisma.aiBudget.findUnique({ where: { account_id: ctx.accountId }, select: { monthly_limit_usd: true } })
    // A new or changed limit starts its notices again for this month: an
    // admin who raised it wants to hear when the new one is reached.
    await prisma.aiBudget.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, monthly_limit_usd: usd, currency, usd_rate: usdRate, limit_amount: limitAmount, rate_auto: rateAuto, updated_by: ctx.userId },
      update: { monthly_limit_usd: usd, currency, usd_rate: usdRate, limit_amount: limitAmount, rate_auto: rateAuto, updated_by: ctx.userId, updated_at: new Date(), warned_month: null, stopped_month: null },
    })
    forgetBudget(ctx.accountId)
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', {
      area: 'ai_budget',
      fields: ['currency', 'limit_amount', 'monthly_limit_usd', 'rate_auto', 'usd_rate'],
      meta: { had_limit: Boolean(before), currency, rate_auto: rateAuto },
    })
    return NextResponse.json(view(await aiBudgetState(ctx.accountId), currency, live))
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
