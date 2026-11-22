import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { handoverSettingsFor, setHandoverSettings } from '@/lib/ai/handover-settings'
import { officeHours } from '@/lib/ai/handover-consent'

/**
 * How the assistant hands a customer to a person (lib/ai/handover-consent.ts):
 * the setting, and the three things it depends on, so the screen can say
 * plainly what will happen — whether offers to agents are on, the team's
 * working hours, and whether staff alerts are set up.
 *
 * Admin only, like the rest of AI Config.
 */

export const dynamic = 'force-dynamic'

async function view(accountId: string) {
  const [settings, leads, ai, hours] = await Promise.all([
    handoverSettingsFor(accountId),
    prisma.leadSettings.findUnique({ where: { account_id: accountId }, select: { offer_enabled: true } }),
    prisma.aiConfig.findUnique({
      where: { account_id: accountId },
      select: { handoff_alert_enabled: true, handoff_alert_numbers: true, handoff_alert_template: true },
    }),
    officeHours(accountId),
  ])
  const numbers = Array.isArray(ai?.handoff_alert_numbers) ? ai!.handoff_alert_numbers.length : 0
  return {
    ask_first: settings.ask_first,
    clarify_first: settings.clarify_first,
    offers_enabled: leads?.offer_enabled ?? false,
    alerts: {
      enabled: ai?.handoff_alert_enabled ?? false,
      numbers,
      template: Boolean(ai?.handoff_alert_template),
    },
    hours: hours.hours,
    open_now: hours.open,
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { ask_first?: unknown; clarify_first?: unknown } | null
    const hasAsk = typeof body?.ask_first === 'boolean'
    const hasClarify = typeof body?.clarify_first === 'boolean'
    if (!body || (!hasAsk && !hasClarify) || ('ask_first' in body && !hasAsk) || ('clarify_first' in body && !hasClarify)) {
      return NextResponse.json({ error: 'Send ask_first and/or clarify_first as true or false.' }, { status: 400 })
    }
    // Change only what was sent; keep the other setting as it is.
    const current = await handoverSettingsFor(ctx.accountId)
    const next = {
      ask_first: hasAsk ? (body.ask_first as boolean) : current.ask_first,
      clarify_first: hasClarify ? (body.clarify_first as boolean) : current.clarify_first,
    }
    await setHandoverSettings(ctx.accountId, next)
    const fields = [hasAsk ? 'ask_first' : null, hasClarify ? 'clarify_first' : null].filter((f): f is string => f !== null)
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', { area: 'ai_handover', fields, meta: next })
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
