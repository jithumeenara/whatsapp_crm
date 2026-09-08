import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

async function requireUser() {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const automation = await prisma.automation.findFirst({
      where: { id, user_id: userId },
    })
    if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const steps = await loadStepsTree(id)
    return NextResponse.json({ automation, steps })
  } catch (err) {
    console.error('[GET /api/automations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    // Ownership check — load existing fields needed for merged validation
    const existing = await prisma.automation.findFirst({
      where: { id, user_id: userId },
      select: { id: true, is_active: true, trigger_type: true, trigger_config: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const update: Record<string, unknown> = {}
    for (const k of [
      'name',
      'description',
      'trigger_type',
      'trigger_config',
      'is_active',
    ] as const) {
      if (k in body) update[k] = body[k]
    }

    const willBeActive =
      typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
    if (willBeActive) {
      const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string

      // IG·01 gated scaffolding — comment_keyword_match is fully built end
      // to end, but Meta will never actually deliver the comments webhook
      // field to this app until instagram_business_manage_comments is
      // approved via App Review. Nothing in this codebase can flip that
      // approval itself, so activation stays blocked with a clear message
      // rather than silently accepting a trigger that will never fire.
      if (mergedTriggerType === 'comment_keyword_match') {
        const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
        const igRows = profile?.account_id
          ? await prisma.$queryRaw<{ comment_dm_status: string | null }[]>`
              SELECT comment_dm_status FROM instagram_config WHERE account_id = ${profile.account_id}::uuid LIMIT 1
            `.catch(() => [] as { comment_dm_status: string | null }[])
          : []
        if ((igRows[0]?.comment_dm_status ?? 'pending_meta_approval') !== 'approved') {
          return NextResponse.json(
            {
              error: 'Comment-to-DM requires Meta App Review approval for instagram_business_manage_comments — this automation can be saved, but not activated, until that approval lands.',
            },
            { status: 400 },
          )
        }
      }

      const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
      const mergedSteps = Array.isArray(body.steps)
        ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
        : await loadStepsTree(id)
      const issues = [
        ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig as Record<string, unknown>),
        ...validateStepsForActivation(mergedSteps),
      ]
      if (issues.length > 0) {
        return NextResponse.json(
          {
            error: 'Cannot keep automation active with invalid configuration',
            issues,
          },
          { status: 400 },
        )
      }
    }

    if (Object.keys(update).length > 0) {
      await prisma.automation.update({
        where: { id },
        data: update,
      })
    }

    if (Array.isArray(body.steps)) {
      const err = await replaceSteps(id, body.steps as BuilderStepInput[])
      if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/automations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Verify ownership before deleting
    const existing = await prisma.automation.findFirst({
      where: { id, user_id: userId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.automation.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/automations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
