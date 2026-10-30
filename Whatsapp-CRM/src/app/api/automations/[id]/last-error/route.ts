import { NextResponse } from 'next/server'
import { automationsMember } from '@/lib/automations/access'
import { prisma } from '@/lib/db'

/**
 * GET /api/automations/[id]/last-error
 *
 * Lightweight, lazily-fetched endpoint for the Automations list's Layer-2
 * expand-in-place row (see automations/page.tsx) — Automation itself has
 * no last_error field (only execution_count/last_executed_at), so this
 * queries the one most recent failed AutomationLog row instead of the
 * account fetching every log up front.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const member = await automationsMember('viewer')
  if (!member.ok) return member.res

  const automation = await prisma.automation.findFirst({
    where: { id, account_id: member.ctx.accountId },
    select: { id: true },
  })
  if (!automation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const lastFailedLog = await prisma.automationLog.findFirst({
    where: { automation_id: id, status: 'failed' },
    orderBy: { created_at: 'desc' },
    select: { error_message: true, created_at: true },
  })

  return NextResponse.json({
    last_error: lastFailedLog
      ? { reason: lastFailedLog.error_message, at: lastFailedLog.created_at }
      : null,
  })
}
