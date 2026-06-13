import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const original = await prisma.automation.findFirst({
      where: { id, user_id: userId },
    })
    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const copy = await prisma.automation.create({
      data: {
        account_id: original.account_id,
        user_id: userId,
        name: `${original.name} (Copy)`,
        description: original.description,
        trigger_type: original.trigger_type,
        trigger_config: original.trigger_config ?? {},
        is_active: false,
      },
    })

    const steps = await prisma.automationStep.findMany({
      where: { automation_id: id },
      select: {
        id: true,
        parent_step_id: true,
        branch: true,
        step_type: true,
        step_config: true,
        position: true,
      },
      orderBy: { position: 'asc' },
    })

    if (steps.length > 0) {
      // Re-map parent_step_id: build old→new id map first so the second
      // pass inserts rows with correct parent references.
      const idMap = new Map<string, string>()
      const uid = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      for (const row of steps) idMap.set(row.id, uid())

      const rows = steps.map((row) => ({
        id: idMap.get(row.id)!,
        automation_id: copy.id,
        parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id) ?? null : null,
        branch: row.branch,
        step_type: row.step_type,
        step_config: row.step_config ?? {},
        position: row.position,
      }))

      await prisma.automationStep.createMany({ data: rows })
    }

    return NextResponse.json({ automation: copy }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/automations/[id]/duplicate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
