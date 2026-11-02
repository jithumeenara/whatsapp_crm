import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { checkOwnedRefs } from '@/lib/leads/owned-refs'
import { reportMetaAdsOutcome } from '@/lib/meta-ads/triggers'
import { audit, auditCtx } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.deal.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Moving a deal into a Won/Lost stage marks it won/lost; moving it back
    // into an open stage reopens it — unless the caller explicitly passed
    // its own status. This is what makes dragging a deal into the Won/Lost
    // column on the board actually close it.
    let status = body.status ?? undefined
    if (body.stage_id && body.stage_id !== existing.stage_id) {
      // A stage of this deal's own pipeline only — any stage id used to
      // be written as given, another pipeline's or another workspace's.
      const targetStage = await prisma.pipelineStage.findFirst({ where: { id: body.stage_id, pipeline_id: existing.pipeline_id } })
      if (!targetStage) return NextResponse.json({ error: 'Stage not found in this pipeline' }, { status: 400 })
      if (status === undefined) status = targetStage.stage_type
    }
    const refProblem = await checkOwnedRefs(ctx.accountId, { contact_id: body.contact_id, assigned_to: body.assigned_to })
    if (refProblem) return NextResponse.json({ error: refProblem }, { status: 400 })

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        stage_id:            body.stage_id            ?? undefined,
        title:               body.title               ?? undefined,
        value:               body.value               ?? undefined,
        currency:            body.currency            ?? undefined,
        notes:               body.notes               ?? undefined,
        expected_close_date: body.expected_close_date ? new Date(body.expected_close_date) : undefined,
        status,
        assigned_to:         body.assigned_to         ?? undefined,
        contact_id:          body.contact_id          ?? undefined,
      },
      include: {
        stage:   { select: { id: true, name: true, color: true } },
        contact: { select: { id: true, name: true, phone: true } },
        lead:    { select: { id: true, title: true, score: true, status: true } },
      },
    })

    {
      const after: Record<string, unknown> = {
        stage_id: body.stage_id ?? undefined,
        title: body.title ?? undefined,
        value: body.value === undefined || body.value === null ? undefined : String(body.value),
        currency: body.currency ?? undefined,
        notes: body.notes ?? undefined,
        expected_close_date: body.expected_close_date ? new Date(body.expected_close_date) : undefined,
        status,
        assigned_to: body.assigned_to ?? undefined,
        contact_id: body.contact_id ?? undefined,
      }
      for (const k of Object.keys(after)) if (after[k] === undefined) delete after[k]
      const before = { ...existing, value: existing.value?.toString() ?? null } as Record<string, unknown>
      const statusMoved = status !== undefined && status !== existing.status
      await audit(auditCtx(req, ctx), {
        action: statusMoved ? 'record.status_changed' : 'record.updated',
        target: { type: 'deal', id, label: null },
        before,
        after,
      })
    }

    // Click-to-WhatsApp attribution — a deal closing is the strongest
    // outcome signal there is; report it if this contact's conversation
    // came from an ad (reportMetaAdsOutcome no-ops otherwise).
    if (deal.status === 'won' && existing.status !== 'won') {
      void reportMetaAdsOutcome({
        accountId: ctx.accountId,
        contactId: deal.contact_id,
        eventName: 'Purchase',
        customData: { currency: deal.currency ?? undefined, value: Number(deal.value) },
      })
    }

    return NextResponse.json({ deal })
  } catch (e) {
    return toErrorResponse(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const { id } = await params

    const existing = await prisma.deal.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.deal.delete({ where: { id } })
    await audit(auditCtx(req, ctx), {
      action: 'record.deleted',
      target: { type: 'deal', id, label: null },
      meta: { pipeline_id: existing.pipeline_id, stage_id: existing.stage_id, status: existing.status, value: existing.value?.toString() ?? null, contact_id: existing.contact_id },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return toErrorResponse(e)
  }
}
