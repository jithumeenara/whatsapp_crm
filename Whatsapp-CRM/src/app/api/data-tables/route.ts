import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { slugify } from '@/lib/data-store/slugify'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  return { ok: true as const, userId: session.user.id, accountId: profile.account_id }
}

export async function GET() {
  try {
    const guard = await requireUser()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const tables = await prisma.dataTable.findMany({
      where: { account_id: guard.accountId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      include: {
        _count: { select: { fields: true, records: true } },
      },
    })
    return NextResponse.json({ tables })
  } catch (err) {
    console.error('[GET /api/data-tables]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireUser()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const baseSlug = slugify(body.name.trim())
    // Ensure slug uniqueness within the account
    const existing = await prisma.dataTable.findMany({
      where: { account_id: guard.accountId, slug: { startsWith: baseSlug } },
      select: { slug: true },
    })
    const slugs = new Set(existing.map((t) => t.slug))
    let slug = baseSlug
    let i = 2
    while (slugs.has(slug)) { slug = `${baseSlug}-${i++}` }

    const table = await prisma.dataTable.create({
      data: {
        account_id: guard.accountId,
        name: body.name.trim(),
        slug,
        icon: body.icon ?? 'database',
        description: body.description ?? null,
      },
    })
    return NextResponse.json({ table }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/data-tables]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
