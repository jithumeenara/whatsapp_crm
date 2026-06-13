import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    // Pull all currently-active runs along with their parent flow's fallback_policy
    const runs = await prisma.flowRun.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        flow_id: true,
        user_id: true,
        contact_id: true,
        last_advanced_at: true,
        flow: { select: { fallback_policy: true } },
      },
    })

    if (!runs.length) return NextResponse.json({ swept: 0 })

    let swept = 0
    for (const r of runs) {
      const policy = resolveFallbackPolicy(r.flow?.fallback_policy ?? null)
      const lastAdvanced = new Date(r.last_advanced_at)
      const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
      if (ageHours < policy.on_timeout_hours) continue

      // Mark timed_out — guarded by the precondition `status='active'`
      // so concurrent advance from a late inbound doesn't overwrite a
      // legitimate update.
      const updated = await prisma.flowRun.updateMany({
        where: { id: r.id, status: 'active' },
        data: {
          status: 'timed_out',
          ended_at: now,
          end_reason: 'stale_sweep',
        },
      })

      if (updated.count > 0) {
        await prisma.flowRunEvent.create({
          data: {
            flow_run_id: r.id,
            event_type: 'timeout',
            payload: {
              age_hours: Math.round(ageHours * 10) / 10,
              policy_hours: policy.on_timeout_hours,
            },
          },
        })
        swept += 1
      }
    }

    return NextResponse.json({ swept })
  } catch (err) {
    console.error('[flows-cron]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
