import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/flows/[id]/last-error
 *
 * Lightweight, lazily-fetched endpoint for the Flows list's Layer-2
 * expand-in-place row (see flows/page.tsx) — separate from the run-history
 * page's full `/runs` endpoint since the list only needs the single most
 * recent failure, not the whole history, and is fetched once per row on
 * first expand rather than for every row up front.
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

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
  }

  const flow = await prisma.flow.findFirst({
    where: { id, account_id: profile.account_id },
    select: { id: true },
  })
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const lastFailedRun = await prisma.flowRun.findFirst({
    where: { flow_id: id, status: 'failed' },
    orderBy: { ended_at: 'desc' },
    select: { end_reason: true, ended_at: true },
  })

  return NextResponse.json({
    last_error: lastFailedRun
      ? { reason: lastFailedRun.end_reason, at: lastFailedRun.ended_at }
      : null,
  })
}
