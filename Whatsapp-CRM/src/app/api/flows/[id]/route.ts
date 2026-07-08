import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert).
 * DELETE /api/flows/[id] — hard delete (CASCADE cleans up nodes,
 *                          runs, events).
 *
 * All three require a signed-in caller who belongs to the flow's account.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireOwnership(
  flowId: string,
): Promise<
  | { ok: true; userId: string; accountId: string }
  | { ok: false; status: number; body: { error: string } }
> {
  if (!UUID_RE.test(flowId)) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }

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

  // Verify the flow belongs to the caller's account
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, account_id: profile.account_id },
    select: { id: true },
  })
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true, userId, accountId: profile.account_id }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const [flow, nodes] = await Promise.all([
      prisma.flow.findUnique({ where: { id } }),
      prisma.flowNode.findMany({
        where: { flow_id: id },
        orderBy: { created_at: 'asc' },
      }),
    ])
    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ flow, nodes })
  } catch (err) {
    console.error('[GET /api/flows/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual' | 'whatsapp_flow'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

/**
 * Protect CRM-only metadata fields from being silently wiped by a stale
 * browser auto-save (the browser may have loaded before a DB patch was applied).
 *
 * Strategy: for every field listed in CRM_COMP_FIELDS, if the incoming
 * component has the field as null/undefined but the DB component has a real
 * value, restore the DB value.  This makes them "sticky" — once set in DB
 * they survive all auto-saves unless the user explicitly clears them through
 * the builder UI (which would set a non-null value, not omit the key).
 */
const CRM_COMP_FIELDS = ['_source_table_id', '_source_field_key', '_save_field_key'] as const

async function mergeStickyCrmMetadata(
  incoming: Record<string, unknown>,
  flowId: string,
): Promise<Record<string, unknown>> {
  const existing = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { trigger_config: true },
  })
  const db = (existing?.trigger_config ?? {}) as Record<string, unknown>
  const result = { ...incoming }

  // Top-level sticky fields
  if (!result.meta_flow_id && db.meta_flow_id) result.meta_flow_id = db.meta_flow_id
  if (!result._save_table_id && db._save_table_id) result._save_table_id = db._save_table_id

  // Screen-level merge
  if (Array.isArray(result.screens) && Array.isArray(db.screens)) {
    const dbScreens = db.screens as Record<string, unknown>[]
    result.screens = (result.screens as Record<string, unknown>[]).map((screen) => {
      const dbScreen = dbScreens.find((s) => (s as Record<string, unknown>).id === screen.id)
      if (!dbScreen) return screen

      const merged: Record<string, unknown> = { ...screen }

      // Preserve terminal flag
      if (!merged.terminal && (dbScreen as Record<string, unknown>).terminal) {
        merged.terminal = (dbScreen as Record<string, unknown>).terminal
      }

      // Component-level merge
      const inComps = (screen.components ?? []) as Record<string, unknown>[]
      const dbComps = ((dbScreen as Record<string, unknown>).components ?? []) as Record<string, unknown>[]
      if (inComps.length > 0 && dbComps.length > 0) {
        merged.components = inComps.map((comp) => {
          const dbComp = dbComps.find(
            (c) => (c as Record<string, unknown>).name === (comp as Record<string, unknown>).name ||
                   (c as Record<string, unknown>).id   === (comp as Record<string, unknown>).id,
          )
          if (!dbComp) return comp
          const m = { ...(comp as Record<string, unknown>) }
          for (const f of CRM_COMP_FIELDS) {
            if (m[f] == null && (dbComp as Record<string, unknown>)[f] != null) {
              m[f] = (dbComp as Record<string, unknown>)[f]
            }
          }
          return m
        })
      }

      return merged
    })
  }

  return result
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = (await request.json().catch(() => null)) as PutBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (body.name !== undefined && !body.name.trim()) {
      return NextResponse.json(
        { error: 'name cannot be empty' },
        { status: 400 },
      )
    }

    const flowPatch: Record<string, unknown> = {
      updated_at: new Date(),
    }
    if (body.name !== undefined) flowPatch.name = body.name.trim()
    if (body.description !== undefined) flowPatch.description = body.description
    if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
    if (body.trigger_config !== undefined) {
      // Merge CRM-only metadata so a stale browser state can't wipe DB-set fields
      const merged = await mergeStickyCrmMetadata(body.trigger_config, id)
      flowPatch.trigger_config = merged as Prisma.InputJsonValue
    }
    if (body.entry_node_id !== undefined) flowPatch.entry_node_id = body.entry_node_id
    if (body.fallback_policy !== undefined) flowPatch.fallback_policy = body.fallback_policy as Prisma.InputJsonValue

    await prisma.flow.update({
      where: { id },
      data: flowPatch,
    })

    if (body.nodes !== undefined) {
      // Delete-then-insert. Not transactional but the runner handles
      // mid-edit reads safely (a node_not_found ends the run cleanly).
      await prisma.flowNode.deleteMany({ where: { flow_id: id } })
      if (body.nodes.length > 0) {
        await prisma.flowNode.createMany({
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

    // Re-fetch and return the new state
    const [flow, nodes] = await Promise.all([
      prisma.flow.findUnique({ where: { id } }),
      prisma.flowNode.findMany({
        where: { flow_id: id },
        orderBy: { created_at: 'asc' },
      }),
    ])
    return NextResponse.json({ flow, nodes })
  } catch (err) {
    console.error('[PUT /api/flows/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const guard = await requireOwnership(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.flow.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/flows/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
