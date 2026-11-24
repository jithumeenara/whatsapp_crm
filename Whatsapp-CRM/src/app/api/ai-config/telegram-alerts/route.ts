import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { setTelegramAlerts, telegramAlertsOn } from '@/lib/ai/telegram-alert-setting'
import { telegramAlertReach } from '@/lib/ai/staff-telegram'

/**
 * "Alert staff on Telegram" (Settings → AI → Hand off when unsure): the
 * switch, and who it would reach right now — counts only, never names,
 * numbers or Telegram ids — so the screen can say what is missing
 * (Admin Chat off, no bot, nobody linked with alerts on).
 *
 * Admin only, like the rest of AI Config.
 */

export const dynamic = 'force-dynamic'

async function view(accountId: string) {
  const [enabled, reach] = await Promise.all([telegramAlertsOn(accountId), telegramAlertReach(accountId)])
  return { enabled, ...reach }
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
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Send enabled as true or false.' }, { status: 400 })
    }
    await setTelegramAlerts(ctx.accountId, body.enabled)
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', { area: 'ai_telegram_alerts', fields: ['enabled'], meta: { enabled: body.enabled } })
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
