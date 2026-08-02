import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')

    const pipelines = await prisma.pipeline.findMany({
      where: { account_id: ctx.accountId },
      include: {
        stages: { orderBy: { position: 'asc' } },
        _count: { select: { deals: true } },
      },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ pipelines })
  } catch (e) {
    return toErrorResponse(e)
  }
}

type StageType = 'open' | 'won' | 'lost'
type StageInput = string | { name: string; stage_type?: StageType; color?: string }

/**
 * Every pipeline must structurally have at least one start (open) stage and
 * exactly one Won + one Lost close stage. Accepts either plain stage-name
 * strings (legacy — type inferred from the name) or {name, stage_type}
 * objects, then normalizes to that guaranteed shape: open stages first (in
 * given order), Won, then Lost last.
 */
function buildStages(input: StageInput[] | undefined): { name: string; stage_type: StageType; color: string }[] {
  const raw = (input && input.length > 0 ? input : ['New', 'In Progress', 'Won', 'Lost'])
    .map((s) => (typeof s === 'string' ? { name: s.trim(), stage_type: undefined as StageType | undefined } : { name: (s.name ?? '').trim(), stage_type: s.stage_type, color: s.color }))
    .filter((s) => s.name)
    .map((s) => ({
      ...s,
      stage_type: s.stage_type ?? (/^won$/i.test(s.name) ? 'won' : /^lost$/i.test(s.name) ? 'lost' : 'open'),
    }))

  // Exactly one of each close type — first occurrence wins, extras demoted to open.
  let wonSeen = false
  let lostSeen = false
  const normalized = raw.map((s) => {
    if (s.stage_type === 'won') {
      if (wonSeen) return { ...s, stage_type: 'open' as StageType }
      wonSeen = true
    } else if (s.stage_type === 'lost') {
      if (lostSeen) return { ...s, stage_type: 'open' as StageType }
      lostSeen = true
    }
    return s
  })

  const opens = normalized.filter((s) => s.stage_type === 'open')
  const won = normalized.find((s) => s.stage_type === 'won') ?? { name: 'Won', stage_type: 'won' as StageType, color: undefined }
  const lost = normalized.find((s) => s.stage_type === 'lost') ?? { name: 'Lost', stage_type: 'lost' as StageType, color: undefined }
  if (opens.length === 0) opens.push({ name: 'New', stage_type: 'open', color: undefined })

  const defaultColors: Record<StageType, string> = { open: '#6366f1', won: '#10b981', lost: '#f43f5e' }
  return [...opens, won, lost].map((s) => ({
    name: s.name,
    stage_type: s.stage_type,
    color: s.color ?? defaultColors[s.stage_type],
  }))
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'admin')
    const body = await req.json()
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const pipeline = await prisma.pipeline.create({
      data: { account_id: ctx.accountId, user_id: ctx.userId, name },
      include: { stages: true, _count: { select: { deals: true } } },
    })

    const stages = buildStages(body.stages)
    await prisma.pipelineStage.createMany({
      data: stages.map((s, i) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        stage_type: s.stage_type,
        position: i,
        color: s.color,
      })),
    })

    const full = await prisma.pipeline.findUnique({
      where: { id: pipeline.id },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { deals: true } } },
    })

    return NextResponse.json({ pipeline: full }, { status: 201 })
  } catch (e) {
    return toErrorResponse(e)
  }
}
