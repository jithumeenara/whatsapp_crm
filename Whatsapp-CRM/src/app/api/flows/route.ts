import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { getFlowTemplate } from '@/lib/flows/templates'

/**
 * GET /api/flows — list the caller's flows.
 * POST /api/flows — create a new (draft) flow.
 */

async function requireUser(): Promise<{ ok: true; userId: string; accountId: string } | { ok: false; status: number; body: { error: string } }> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const userId = session.user.id

  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return { ok: false, status: 403, body: { error: 'Your profile is not linked to an account.' } }
  }

  return { ok: true, userId, accountId: profile.account_id }
}

export async function GET(request: Request) {
  try {
    const guard = await requireUser()
    if (!guard.ok) {
      return NextResponse.json(guard.body, { status: guard.status })
    }
    const { accountId } = guard

    const { searchParams } = new URL(request.url)
    const flowType = searchParams.get('flow_type') ?? undefined
    const status = searchParams.get('status') ?? undefined

    const flows = await prisma.flow.findMany({
      where: {
        account_id: accountId,
        ...(flowType ? { flow_type: flowType } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ flows })
  } catch (err) {
    console.error('[GET /api/flows]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireUser()
    if (!guard.ok) {
      return NextResponse.json(guard.body, { status: guard.status })
    }
    const { userId, accountId } = guard

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string
          description?: string | null
          trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
          trigger_config?: Record<string, unknown>
          template_slug?: string
        }
      | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // -------- Template clone path --------
    if (body.template_slug) {
      const template = getFlowTemplate(body.template_slug)
      if (!template) {
        return NextResponse.json(
          { error: `Unknown template_slug "${body.template_slug}"` },
          { status: 400 },
        )
      }

      const flow = await prisma.flow.create({
        data: {
          user_id: userId,
          account_id: accountId,
          name: body.name?.trim() || template.name,
          description: template.description,
          status: 'draft',
          trigger_type: template.trigger_type,
          trigger_config: template.trigger_config as Prisma.InputJsonValue,
          entry_node_id: template.entry_node_id,
        },
      })

      if (template.nodes.length > 0) {
        try {
          await prisma.flowNode.createMany({
            data: template.nodes.map((n) => ({
              flow_id: flow.id,
              node_key: n.node_key,
              node_type: n.node_type,
              config: n.config as Prisma.InputJsonValue,
            })),
          })
        } catch (nodesErr) {
          // Roll back the parent flow so a half-cloned template doesn't
          // sit as an empty draft.
          await prisma.flow.delete({ where: { id: flow.id } })
          throw nodesErr
        }
      }
      return NextResponse.json({ flow }, { status: 201 })
    }

    // -------- Plain (empty) create path --------
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const trigger_type = body.trigger_type ?? 'keyword'

    const flow = await prisma.flow.create({
      data: {
        user_id: userId,
        account_id: accountId,
        name: body.name.trim(),
        description: body.description ?? null,
        status: 'draft',
        trigger_type,
        trigger_config: (body.trigger_config ?? {}) as Prisma.InputJsonValue,
      },
    })
    return NextResponse.json({ flow }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/flows]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
