import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { syncGoogleForm } from '@/lib/google/forms'
import { logGoogleActivity } from '@/lib/google/oauth'
import { formsFailure } from '@/lib/google/forms-http'

type Ctx = { params: Promise<{ id: string }> }

/** Sync now. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    return NextResponse.json(await syncGoogleForm(id, ctx.accountId))
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
    return NextResponse.json({ ok: true, auto_sync: body.auto_sync })
  } catch (err) {
    return formsFailure(err)
  }
}

/** Unlink. The table and its records stay. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const link = await prisma.googleFormLink.findFirst({ where: { id, account_id: ctx.accountId }, select: { form_title: true } })
    const res = await prisma.googleFormLink.deleteMany({ where: { id, account_id: ctx.accountId } })
    if (res.count === 0) return NextResponse.json({ error: 'That form link no longer exists.' }, { status: 404 })
    await logGoogleActivity(ctx.accountId, ctx.userId, 'form_unlinked', link?.form_title ?? undefined)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return formsFailure(err)
  }
}
