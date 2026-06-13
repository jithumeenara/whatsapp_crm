import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { validateFlowForActivation } from '@/lib/flows/validate'

/**
 * POST /api/flows/[id]/activate
 *
 * Body: { status: 'draft' | 'active' | 'archived' }
 *
 * Activating runs the full validator and refuses on any 'error'
 * severity issue. Drafts and archives are unconditional.
 *
 * Returns the updated flow on success; on validation failure returns
 * the full issue list.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    )
  }

  try {
    // Verify ownership via account membership
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const existing = await prisma.flow.findFirst({
      where: { id, account_id: profile.account_id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (status === 'active') {
      // Re-load with the full payload the validator needs
      const [flow, nodes] = await Promise.all([
        prisma.flow.findUnique({
          where: { id },
          select: { name: true, trigger_type: true, trigger_config: true, entry_node_id: true },
        }),
        prisma.flowNode.findMany({
          where: { flow_id: id },
          select: { node_key: true, node_type: true, config: true },
        }),
      ])
      if (!flow) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      const issues = validateFlowForActivation(
        flow as {
          name: string
          trigger_type: 'keyword' | 'first_inbound_message' | 'manual'
          trigger_config: Record<string, unknown>
          entry_node_id: string | null
        },
        nodes as Array<{
          node_key: string
          node_type: string
          config: Record<string, unknown>
        }>,
      )
      const blockers = issues.filter((i) => i.severity === 'error')
      if (blockers.length > 0) {
        return NextResponse.json(
          {
            error: 'Cannot activate flow — fix the issues below first.',
            issues,
          },
          { status: 422 },
        )
      }
    }

    const updated = await prisma.flow.update({
      where: { id },
      data: { status, updated_at: new Date() },
    })
    return NextResponse.json({ flow: updated })
  } catch (err) {
    console.error('[POST /api/flows/[id]/activate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
