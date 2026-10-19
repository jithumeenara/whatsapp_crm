import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { GoogleNotConnectedError } from '@/lib/google/oauth'
import { SheetsApiError } from '@/lib/google/sheets'
import { runGoogleSheetStep, type SheetStepConfig } from '@/lib/google/sheet-step'
import { businessTimezone } from '@/lib/ai/human-date'

/**
 * POST { config, samples: { "{{vars.reg}}": "R-102", "{{contact.phone}}": "+91…" } }
 *
 * The chatbot builder's Test for a Google Sheet step: what the step would
 * add, change or delete, with the typed samples in place of its
 * variables. Writes NOTHING (dry run). Admins only — it reads the sheet.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`google:stepTest:${ctx.accountId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return NextResponse.json({ error: 'Too many tests at once. Wait a minute and try again.' }, { status: 429 })
    const body = (await req.json().catch(() => null)) as { config?: unknown; samples?: unknown } | null
    const raw = (body?.config && typeof body.config === 'object' ? body.config : {}) as Record<string, unknown>
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
    const list = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>).slice(0, 100) : [])
    // Copied field by field — never the body as it came.
    const cfg: SheetStepConfig = {
      spreadsheet_id: str(raw.spreadsheet_id, 200),
      sheet_title: str(raw.sheet_title, 200),
      action: str(raw.action, 10),
      add_mode: str(raw.add_mode, 12),
      match: str(raw.match, 4),
      which: str(raw.which, 8),
      date_column: str(raw.date_column, 200),
      delete_mode: str(raw.delete_mode, 8),
      older_than_days: Number(raw.older_than_days) || 0,
      mapping: list(raw.mapping).map((m) => ({ column: str(m.column, 200), value: str(m.value, 2000) })),
      conditions: list(raw.conditions).slice(0, 5).map((c) => ({ column: str(c.column, 200), op: str(c.op, 10) as 'equals', value: str(c.value, 500) })),
    }
    const samples = new Map<string, string>()
    if (body?.samples && typeof body.samples === 'object') {
      for (const [k, v] of Object.entries(body.samples as Record<string, unknown>).slice(0, 50)) {
        if (typeof v === 'string') samples.set(k.trim().toLowerCase(), v.slice(0, 500))
      }
    }
    // A token with no sample becomes empty — the same as an unset variable.
    const resolve = (t: string) => t.replace(/\{\{[^}]+\}\}/g, (tok) => samples.get(tok.toLowerCase()) ?? '')
    const result = await runGoogleSheetStep({ accountId: ctx.accountId, cfg, resolve, timeZone: await businessTimezone(ctx.accountId), dryRun: true })
    return NextResponse.json({
      outcome: result.outcome, found: result.found, reason: result.reason ?? null, warnings: result.warnings, tab: result.tab,
      rows: result.rows.slice(0, 5),
    })
  } catch (err) {
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    if (err instanceof Error && !/prisma|database/i.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
