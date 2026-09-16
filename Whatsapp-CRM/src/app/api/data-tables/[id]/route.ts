import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { invalidateRegistrationForms } from '@/lib/ai/registration'

async function requireOwner(tableId: string) {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }

  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: profile.account_id },
    include: {
      fields: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] },
      _count: { select: { records: true } },
    },
  })
  if (!table) return { ok: false as const, status: 404, body: { error: 'Table not found.' } }
  return { ok: true as const, accountId: profile.account_id, table }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const guard = await requireOwner(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
    return NextResponse.json({ table: guard.table })
  } catch (err) {
    console.error('[GET /api/data-tables/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const guard = await requireOwner(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => ({}))
    const table = await prisma.dataTable.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        // Whether the assistant may create rows here on a customer's
        // behalf, and what it says once one lands. Coerced rather than
        // passed through: this flag decides whether a language model can
        // write to this table, and it is not somewhere to accept a
        // truthy string.
        ...(body.ai_can_register !== undefined
          ? { ai_can_register: body.ai_can_register === true }
          : {}),
        ...(body.ai_success_message !== undefined
          ? {
              ai_success_message:
                typeof body.ai_success_message === 'string'
                  ? body.ai_success_message.trim().slice(0, 500) || null
                  : null,
            }
          : {}),
      },
    })
    // The assistant caches which tables it may write into for a minute.
    // Without this, turning the switch on and immediately testing on
    // WhatsApp looks broken for up to sixty seconds — which is exactly
    // when somebody is watching.
    invalidateRegistrationForms(guard.accountId)
    return NextResponse.json({ table })
  } catch (err) {
    console.error('[PUT /api/data-tables/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const guard = await requireOwner(id)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    await prisma.dataTable.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/data-tables/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
