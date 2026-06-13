import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function requireOwnership(id: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return { ok: false as const, status: 403, body: { error: 'Profile not linked to an account.' } }
  }
  const chatbot = await prisma.flow.findFirst({
    where: { id, account_id: profile.account_id, flow_type: 'chatbot' },
    select: { id: true },
  })
  if (!chatbot) {
    return { ok: false as const, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true as const, userId: session.user.id, accountId: profile.account_id }
}

/** GET /api/chatbot/[id] — fetch chatbot with its nodes */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const [chatbot, nodes] = await Promise.all([
      prisma.flow.findUnique({ where: { id } }),
      prisma.flowNode.findMany({ where: { flow_id: id }, orderBy: { created_at: 'asc' } }),
    ])
    return NextResponse.json({ chatbot, nodes })
  } catch (err) {
    console.error('[GET /api/chatbot/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/chatbot/[id] — full save: name, trigger, entry, nodes.
 * Deletes all existing nodes then re-inserts them (same pattern as flows).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await request.json().catch(() => null) as {
      name?: string
      description?: string | null
      trigger_type?: string
      trigger_config?: Record<string, unknown>
      entry_node_id?: string | null
      status?: string
      nodes?: Array<{
        node_key: string
        node_type: string
        config: Record<string, unknown>
        position_x?: number
        position_y?: number
      }>
    } | null

    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const patch: Record<string, unknown> = { updated_at: new Date() }
    if (body.name !== undefined)          patch.name          = body.name
    if (body.description !== undefined)   patch.description   = body.description
    if (body.trigger_type !== undefined)  patch.trigger_type  = body.trigger_type
    if (body.trigger_config !== undefined) patch.trigger_config = body.trigger_config as Prisma.InputJsonValue
    if (body.entry_node_id !== undefined) patch.entry_node_id = body.entry_node_id
    if (body.status !== undefined)        patch.status        = body.status

    await prisma.$transaction(async (tx) => {
      await tx.flow.update({ where: { id }, data: patch })

      if (body.nodes !== undefined) {
        await tx.flowNode.deleteMany({ where: { flow_id: id } })
        if (body.nodes.length > 0) {
          await tx.flowNode.createMany({
            data: body.nodes.map((n) => ({
              flow_id: id,
              node_key: n.node_key,
              node_type: n.node_type,
              config: n.config as Prisma.InputJsonValue,
              position_x: n.position_x ?? 0,
              position_y: n.position_y ?? 0,
            })),
          })
        }
      }
    })

    const [chatbot, nodes] = await Promise.all([
      prisma.flow.findUnique({ where: { id } }),
      prisma.flowNode.findMany({ where: { flow_id: id }, orderBy: { created_at: 'asc' } }),
    ])
    return NextResponse.json({ chatbot, nodes })
  } catch (err) {
    console.error('[PUT /api/chatbot/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PATCH /api/chatbot/[id] — update status only (activate/deactivate) */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const { status } = (await request.json().catch(() => ({}))) as { status?: string }
    if (!status || !['draft', 'active', 'archived'].includes(status)) {
      return NextResponse.json({ error: 'Valid status required: draft | active | archived' }, { status: 400 })
    }

    const chatbot = await prisma.flow.update({
      where: { id },
      data: { status },
    })
    return NextResponse.json({ chatbot })
  } catch (err) {
    console.error('[PATCH /api/chatbot/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/chatbot/[id] — hard delete (cascades to nodes) */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.flow.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/chatbot/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
