import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { syncGoogleForm } from '@/lib/google/forms'
import { logGoogleActivity } from '@/lib/google/oauth'
import { formsFailure } from '@/lib/google/forms-http'
import { audit, auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'

type Ctx = { params: Promise<{ id: string }> }

/** Sync now. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const res = await syncGoogleForm(id, ctx.accountId)
    await audit(auditCtx(req, ctx), {
      action: 'import.completed',
      target: { type: 'google_form_link', id },
      meta: { via: 'google_form_sync', records: res.imported },
    })
    return NextResponse.json(res)
  } catch (err) {
    return formsFailure(err)
  }
}

/** Keep in sync on or off. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { auto_sync?: unknown }
    if (typeof body.auto_sync !== 'boolean') return NextResponse.json({ error: 'auto_sync is required.' }, { status: 400 })
    const res = await prisma.googleFormLink.updateMany({ where: { id, account_id: ctx.accountId }, data: { auto_sync: body.auto_sync } })
    if (res.count === 0) return NextResponse.json({ error: 'That form link no longer exists.' }, { status: 404 })
    await auditConfigChange(auditCtx(req, ctx), 'config.google_changed', {
      area: 'google_form_link',
      fields: ['auto_sync'],
      target: { type: 'google_form_link', id },
      meta: { auto_sync: body.auto_sync },
    })
    return NextResponse.json({ ok: true, auto_sync: body.auto_sync })
  } catch (err) {
    return formsFailure(err)
  }
}

/** Unlink. The table and its records stay. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const link = await prisma.googleFormLink.findFirst({ where: { id, account_id: ctx.accountId }, select: { form_title: true } })
    const res = await prisma.googleFormLink.deleteMany({ where: { id, account_id: ctx.accountId } })
    if (res.count === 0) return NextResponse.json({ error: 'That form link no longer exists.' }, { status: 404 })
    await logGoogleActivity(ctx.accountId, ctx.userId, 'form_unlinked', link?.form_title ?? undefined)
    await audit(auditCtx(req, ctx), {
      action: 'record.deleted',
      target: { type: 'google_form_link', id },
      meta: { note: 'unlinked; table and records kept' },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return formsFailure(err)
  }
}
