import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/flows/[id]/runs
 *
 * Newest-first list of flow runs for a single flow, with the latest
 * event timeline embedded for each. Used by the run-history viewer
 * page (`/flows/[id]/runs`).
 *
 * Limited to the 50 most recent runs.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    // Verify flow exists and belongs to the caller's account
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const flow = await prisma.flow.findFirst({
      where: { id, account_id: profile.account_id },
      select: { id: true, name: true },
    })
    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Pull runs with contact info
    const runs = await prisma.flowRun.findMany({
      where: { flow_id: id },
      select: {
        id: true,
        status: true,
        current_node_key: true,
        started_at: true,
        last_advanced_at: true,
        ended_at: true,
        end_reason: true,
        vars: true,
        reprompt_count: true,
        contact: {
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: { started_at: 'desc' },
      take: 50,
    })

    const runIds = runs.map((r) => r.id)
    let events: Array<{
      flow_run_id: string
      event_type: string
      node_key: string | null
      payload: Record<string, unknown>
      created_at: Date
    }> = []

    if (runIds.length > 0) {
      try {
        events = await prisma.flowRunEvent.findMany({
          where: { flow_run_id: { in: runIds } },
          select: {
            flow_run_id: true,
            event_type: true,
            node_key: true,
            payload: true,
            created_at: true,
          },
          orderBy: { created_at: 'asc' },
        }) as typeof events
      } catch (evsErr) {
        // Non-fatal — the page can still show runs without timelines.
        console.error('[flows-runs] events fetch failed:', evsErr)
      }
    }

    return NextResponse.json({
      flow,
      runs,
      events,
    })
  } catch (err) {
    console.error('[GET /api/flows/[id]/runs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
