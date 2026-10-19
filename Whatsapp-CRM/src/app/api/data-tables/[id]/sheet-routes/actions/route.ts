import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { businessNow } from '@/lib/google/sheet-step'
import { previewRouting, type RouteField } from '@/lib/google/sheet-route-rules'
import { aiRuleSystemPrompt, parseAiRule, cleanConditions } from '@/lib/google/sheet-route-input'
import { enqueueBackfill, retryFailed, toRule } from '@/lib/google/sheet-routing'

/**
 * POST { action } for a table's Sheet routing (admins):
 *   preview  { rule? } — how many rows would go where. Reads the table only;
 *            nothing is sent. With `rule`, that unsaved rule is counted alone.
 *   backfill — send every existing row (queued; Google's limits respected).
 *   retry    — failed deliveries back in the queue.
 *   ai       { text } — a rule drafted from plain words, for the person to
 *            check and save. Never saved here.
 */
const PREVIEW_MAX = 5000

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const table = await prisma.dataTable.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, fields: { orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true, options: true } } },
    })
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const fields = table.fields as RouteField[]
    const body = (await req.json().catch(() => null)) as { action?: unknown; text?: unknown; rule?: unknown } | null
    const action = body?.action

    if (action === 'preview') {
      const [state, routes, records] = await Promise.all([
        prisma.sheetRouteTable.findUnique({ where: { table_id: id } }),
        prisma.sheetRoute.findMany({ where: { table_id: id, account_id: ctx.accountId }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] }),
        prisma.dataRecord.findMany({ where: { table_id: id, account_id: ctx.accountId }, orderBy: { created_at: 'desc' }, take: PREVIEW_MAX, select: { id: true, data: true, created_at: true } }),
      ])
      let rules = routes.map(toRule)
      // An unsaved rule from the editor: counted on its own.
      if (body?.rule && typeof body.rule === 'object') {
        const r = body.rule as Record<string, unknown>
        rules = [toRule({
          id: 'draft', name: String(r.name ?? 'This rule').slice(0, 120), enabled: true, is_fallback: false,
          match: r.match === 'any' ? 'any' : 'all', conditions: cleanConditions(r.conditions, fields) as never,
          spreadsheet_id: 'draft', tab_title: typeof r.tab_title === 'string' ? r.tab_title.slice(0, 100) : 'Sheet1',
          split_template: typeof r.split_template === 'string' && r.split_template.trim() ? r.split_template.slice(0, 200) : null,
          split_into: r.split_into === 'sheet' ? 'sheet' : 'tab', columns: [],
        })]
      }
      const now = businessNow(await businessTimezone(ctx.accountId))
      const p = previewRouting({
        rules, fields, mode: state?.mode === 'all' ? 'all' : 'first', nowWall: now.nowWall,
        records: records.map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, unknown>, created_at: r.created_at })),
      })
      return NextResponse.json({ ...p, capped: records.length >= PREVIEW_MAX })
    }

    if (action === 'backfill') {
      const limit = checkRateLimit(`sheetRoute:backfill:${id}`, { limit: 5, windowMs: 10 * 60_000 })
      if (!limit.success) return NextResponse.json({ error: 'Already sending — wait a few minutes.' }, { status: 429 })
      if ((await prisma.sheetRoute.count({ where: { table_id: id, enabled: true } })) === 0) {
        return NextResponse.json({ error: 'Add a rule first.' }, { status: 400 })
      }
      const queued = await enqueueBackfill(id, ctx.accountId)
      return NextResponse.json({ queued })
    }

    if (action === 'retry') {
      return NextResponse.json({ retried: await retryFailed(id, ctx.accountId) })
    }

    if (action === 'ai') {
      const limit = checkRateLimit(`sheetRoute:ai:${ctx.userId}`, RATE_LIMITS.adminAction)
      if (!limit.success) return NextResponse.json({ error: 'Too many at once. Wait a minute.' }, { status: 429 })
      const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : ''
      if (text.length < 4) return NextResponse.json({ error: 'Describe the rule in a sentence.' }, { status: 400 })
      const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId } })
      if (!aiConfig) return NextResponse.json({ error: 'Set up the AI assistant in Settings first, or build the rule by hand.' }, { status: 400 })
      const { generateAiReplyWithFallback } = await import('@/lib/ai/providers/registry')
      const { recordAiUsage } = await import('@/lib/ai/usage')
      const started = Date.now()
      const now = businessNow(await businessTimezone(ctx.accountId))
      let result
      try {
        result = await generateAiReplyWithFallback(
          { ...aiConfig, temperature: 0, max_tokens: Math.max(aiConfig.max_tokens, 800), reasoning_effort: 'low' },
          aiRuleSystemPrompt(fields, now.today),
          text,
        )
      } catch (err) {
        console.error('[sheet-routing] ai rule failed:', err)
        return NextResponse.json({ error: 'The AI could not be reached. Build the rule by hand, or try again.' }, { status: 502 })
      }
      void recordAiUsage({ accountId: ctx.accountId, provider: result.usedProvider, model: result.usedModel ?? 'unknown', feature: 'sheet_rule', tokens: result.usage, latencyMs: Date.now() - started })
      const draft = parseAiRule(result.reply ?? '', fields)
      if (!draft) return NextResponse.json({ error: 'The AI did not give a usable rule. Try saying it differently, or build it by hand.' }, { status: 422 })
      return NextResponse.json({ draft })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
