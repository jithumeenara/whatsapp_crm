import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const due = await prisma.automationPendingExecution.findMany({
      where: {
        status: 'pending',
        run_at: { lte: now },
      },
      orderBy: { run_at: 'asc' },
      take: 50,
    })

    if (due.length === 0) return NextResponse.json({ processed: 0 })

    let processed = 0
    for (const row of due) {
      // Claim the row — conditional update acts as a lock
      const claimed = await prisma.automationPendingExecution.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'running' },
      })
      if (claimed.count === 0) continue

      await resumePendingExecution({
        id: row.id,
        automation_id: row.automation_id,
        account_id: row.account_id,
        user_id: row.user_id,
        contact_id: row.contact_id ?? null,
        log_id: row.log_id ?? null,
        parent_step_id: row.parent_step_id ?? null,
        branch: (row.branch as 'yes' | 'no' | null) ?? null,
        next_step_position: row.next_step_position,
        context: (row.context as AutomationContext) ?? {},
      })
      processed++
    }

    return NextResponse.json({ processed })
  } catch (err) {
    console.error('[automations-cron]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
