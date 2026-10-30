import { NextResponse } from 'next/server'
import { automationsMember } from '@/lib/automations/access'
import { prisma } from '@/lib/db'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET() {
  const member = await automationsMember('viewer')
  if (!member.ok) return member.res

  try {
    const automations = await prisma.automation.findMany({
      where: { account_id: member.ctx.accountId },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ automations })
  } catch (err) {
    console.error('[GET /api/automations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const member = await automationsMember('agent')
  if (!member.ok) return member.res
  const { userId, accountId } = member.ctx

  try {

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { name, description, trigger_type, trigger_config, is_active, steps, template } = body

    let effectiveSteps: BuilderStepInput[] | undefined = steps
    let effectiveName = name
    let effectiveDescription = description
    let effectiveTriggerType = trigger_type
    let effectiveTriggerConfig = trigger_config

    if (template && (!steps || steps.length === 0)) {
      const t = getTemplate(template)
      if (t) {
        effectiveName = effectiveName ?? t.name
        effectiveDescription = effectiveDescription ?? t.description
        effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
        effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
        effectiveSteps = t.steps as unknown as BuilderStepInput[]
      }
    }

    if (!effectiveName || !effectiveTriggerType) {
      return NextResponse.json(
        { error: 'name and trigger_type are required' },
        { status: 400 },
      )
    }

    if (is_active) {
      // IG·01 gated scaffolding — see the matching check in
      // /api/automations/[id]'s PATCH handler for the full rationale.
      if (effectiveTriggerType === 'comment_keyword_match') {
        const igRows = await prisma.$queryRaw<{ comment_dm_status: string | null }[]>`
          SELECT comment_dm_status FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1
        `.catch(() => [] as { comment_dm_status: string | null }[])
        if ((igRows[0]?.comment_dm_status ?? 'pending_meta_approval') !== 'approved') {
          return NextResponse.json(
            { error: 'Comment-to-DM requires Meta App Review approval for instagram_business_manage_comments — this automation can be saved, but not activated, until that approval lands.' },
            { status: 400 },
          )
        }
      }
      const issues = [
        ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig ?? {}),
        ...validateStepsForActivation(
          (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[],
        ),
      ]
      if (issues.length > 0) {
        return NextResponse.json(
          { error: 'Cannot activate automation with invalid configuration', issues },
          { status: 400 },
        )
      }
    }

    const automation = await prisma.automation.create({
      data: {
        user_id: userId,
        account_id: accountId,
        name: effectiveName,
        description: effectiveDescription ?? null,
        trigger_type: effectiveTriggerType,
        trigger_config: effectiveTriggerConfig ?? {},
        is_active: !!is_active,
      },
    })

    if (effectiveSteps && effectiveSteps.length > 0) {
      const err = await insertSteps(automation.id, effectiveSteps)
      if (err) return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ automation }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/automations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
