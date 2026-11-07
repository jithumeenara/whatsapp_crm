import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { parseFunnel } from '@/lib/reports/settings'

/**
 * GET /api/leads/[id]/stage — the business's funnel stages and the stage
 * this lead last reached, for the lead page. Marking a stage goes through
 * PATCH /api/leads/[id] { funnel_stage }, which holds the permission and
 * closing rules.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { id } = await params
    const lead = await prisma.lead.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true } })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const settings = await prisma.leadSettings.findUnique({ where: { account_id: ctx.accountId }, select: { funnel_stages: true } })
    const stages = parseFunnel(settings?.funnel_stages)
    if (stages.length === 0) return NextResponse.json({ stages: [], current: null, reachedAt: null })

    const last = await prisma.leadActivity.findFirst({
      where: { lead_id: id, account_id: ctx.accountId, type: 'stage' },
      orderBy: { created_at: 'desc' },
      select: { metadata: true, created_at: true },
    })
    const key = (last?.metadata as { stage_key?: unknown } | null)?.stage_key
    const current = typeof key === 'string' && stages.some((s) => s.key === key) ? key : null
    return NextResponse.json({ stages, current, reachedAt: current ? last?.created_at ?? null : null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
