import { NextResponse } from 'next/server'
import { dataStoreMember } from '@/lib/data-store/access'
import { prisma } from '@/lib/db'
import { slugify } from '@/lib/data-store/slugify'
import { verifyApiKey } from '@/lib/auth/api-key'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/** Session OR API key. Returns the resolved accountId on success. */
async function requireAuth(req: Request): Promise<
  | { ok: true; accountId: string }
  | { ok: false; status: number; body: { error: string } }
> {
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer wcrm_')) {
    const raw = authHeader.slice('Bearer '.length)
    const keyPrefix = raw.slice(0, 12)
    const isWrite = req.method !== 'GET'
    const rl = checkRateLimit(`api:${keyPrefix}`, isWrite ? RATE_LIMITS.apiWrite : RATE_LIMITS.apiRead)
    if (!rl.success) return { ok: false, status: 429, body: { error: 'Rate limit exceeded.' } }

    const result = await verifyApiKey(raw)
    if (!result) return { ok: false, status: 401, body: { error: 'Invalid API key.' } }
    return { ok: true, accountId: result.accountId }
  }

  const member = await dataStoreMember(req.method === 'GET' ? 'viewer' : 'supervisor')
  if (!member.ok) return member
  const accountIdOf = member.ctx.accountId
  return { ok: true, accountId: accountIdOf }
}

export async function GET(req: Request) {
  try {
    const guard = await requireAuth(req)
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
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireAuth(req)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required.' }, { status: 400 })

    const baseSlug = slugify(body.name.trim())
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
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
