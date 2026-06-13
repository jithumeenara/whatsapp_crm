import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const automations = await prisma.automation.findMany({
      where: { account_id: profile.account_id },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ automations })
  } catch (err) {
    console.error('[GET /api/automations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

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
