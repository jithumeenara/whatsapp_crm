import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { linkGoogleForm } from '@/lib/google/forms'
import { formsFailure } from '@/lib/google/forms-http'
import { logGoogleActivity } from '@/lib/google/oauth'
import { ensureGoogleTables } from '@/lib/google/store'

/** The linked forms, each with its table and how it last went. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    await ensureGoogleTables()
    const links = await prisma.googleFormLink.findMany({ where: { account_id: ctx.accountId }, orderBy: { created_at: 'desc' } })
    const counts = links.length
      ? await prisma.dataRecord.groupBy({ by: ['table_id'], where: { table_id: { in: links.map((l) => l.table_id) } }, _count: { _all: true } })
      : []
    const count = new Map(counts.map((c) => [c.table_id, c._count._all]))
    return NextResponse.json({
      links: links.map((l) => ({
        id: l.id,
        table_id: l.table_id,
        form_title: l.form_title,
        responder_url: l.responder_url,
        auto_sync: l.auto_sync,
        records: count.get(l.table_id) ?? 0,
        last_synced_at: l.last_synced_at,
        last_error: l.last_error,
      })),
    })
  } catch (err) {
    return formsFailure(err)
  }
}

/** Link a picked form: its table is made and its responses brought in. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { formId?: unknown }
    if (typeof body.formId !== 'string') return NextResponse.json({ error: 'formId is required.' }, { status: 400 })
    const res = await linkGoogleForm(ctx.accountId, body.formId)
    await logGoogleActivity(ctx.accountId, ctx.userId, 'form_linked', `${res.imported} responses brought in`)
    return NextResponse.json(res, { status: 201 })
  } catch (err) {
    return formsFailure(err)
  }
}
