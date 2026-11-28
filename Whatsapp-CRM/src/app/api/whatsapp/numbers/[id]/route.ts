import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'

/**
 * PATCH /api/whatsapp/numbers/[id] — { label }: the name shown wherever a
 * workspace with several numbers picks one ("Admissions", "Support").
 * Owner only; the number must belong to this workspace.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null
    if (typeof body?.label !== 'string') return NextResponse.json({ error: 'Send label as text.' }, { status: 400 })
    // Plain text, no control or direction characters, 40 at most; empty clears it.
    const label = body.label.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, 40)
    const updated = await prisma.whatsAppConfig.updateMany({ where: { id, account_id: ctx.accountId }, data: { label: label || null } })
    if (updated.count === 0) return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    await auditConfigChange(auditCtx(request, ctx), 'config.whatsapp_changed', {
      area: 'whatsapp_number_label', fields: ['label'], target: { type: 'whatsapp_config', id },
    })
    return NextResponse.json({ id, label: label || null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
