import { NextResponse } from 'next/server'
import { commentsReady } from '@/lib/meta/social-comments'
import { automationsMember } from '@/lib/automations/access'
import { prisma } from '@/lib/db'
import { audit, auditCtx } from '@/lib/audit'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const member = await automationsMember('viewer')
  if (!member.ok) return member.res
  const { userId, accountId } = member.ctx

  try {
    const automation = await prisma.automation.findFirst({
      where: { id, user_id: userId, account_id: accountId },
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
  const member = await automationsMember('agent')
  if (!member.ok) return member.res
  const { userId, accountId } = member.ctx

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    // Ownership check — load existing fields needed for merged validation
    const existing = await prisma.automation.findFirst({
      where: { id, user_id: userId, account_id: accountId },
      select: { id: true, name: true, description: true, is_active: true, trigger_type: true, trigger_config: true },
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

      // Comment automations can only fire once Meta delivers comments to
      // this workspace (comment permission approved): see commentsReady.
      if (mergedTriggerType === 'comment_keyword_match' && (!accountId || !(await commentsReady(accountId)))) {
        return NextResponse.json({ error: 'Comment automations start once Meta delivers comments to this workspace. Your Meta app needs comment access approved (Instagram: instagram_manage_comments; Facebook: pages_manage_engagement). You can save this automation now and switch it on later.' }, { status: 400 })
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

    const onlyActive = Object.keys(update).length === 1 && 'is_active' in update && !Array.isArray(body.steps)
    await audit(auditCtx(request, member.ctx), {
      action: onlyActive ? 'record.status_changed' : 'record.updated',
      target: { type: 'automation', id, label: typeof update.name === 'string' ? update.name : existing.name },
      before: existing as unknown as Record<string, unknown>,
      after: update,
      meta: Array.isArray(body.steps) ? { steps_replaced: body.steps.length } : null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/automations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const member = await automationsMember('agent')
  if (!member.ok) return member.res
  const { userId, accountId } = member.ctx

  try {
    // Verify ownership before deleting
    const existing = await prisma.automation.findFirst({
      where: { id, user_id: userId, account_id: accountId },
      select: { id: true, name: true, trigger_type: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.automation.delete({ where: { id } })
    await audit(auditCtx(request, member.ctx), {
      action: 'record.deleted',
      target: { type: 'automation', id, label: existing.name },
      meta: { trigger_type: existing.trigger_type },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/automations/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
