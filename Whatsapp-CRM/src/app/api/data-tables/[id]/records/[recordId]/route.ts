import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function requireRecord(tableId: string, recordId: string) {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  const record = await prisma.dataRecord.findFirst({
    where: { id: recordId, table_id: tableId, account_id: profile.account_id },
  })
  if (!record) return { ok: false as const, status: 404, body: { error: 'Record not found.' } }
  return { ok: true as const, record }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id: tableId, recordId } = await params
    const guard = await requireRecord(tableId, recordId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const record = await prisma.dataRecord.update({
      where: { id: recordId },
      data: { data: body.data ?? {} },
    })
    return NextResponse.json({ record })
  } catch (err) {
    console.error('[PUT /api/data-tables/[id]/records/[recordId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id: tableId, recordId } = await params
    const guard = await requireRecord(tableId, recordId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.dataRecord.delete({ where: { id: recordId } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/data-tables/[id]/records/[recordId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
