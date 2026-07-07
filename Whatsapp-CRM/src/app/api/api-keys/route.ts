import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { generateApiKey } from '@/lib/auth/api-key'

async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized.' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  return { ok: true as const, accountId: profile.account_id }
}

export async function GET() {
  try {
    const guard = await requireSession()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const keys = await prisma.apiKey.findMany({
      where: { account_id: guard.accountId },
      select: {
        id: true,
        name: true,
        key_prefix: true,
        last_used_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ keys })
  } catch (err) {
    console.error('[GET /api/api-keys]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSession()
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim()
    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (name.length > 80) return NextResponse.json({ error: 'name too long.' }, { status: 400 })

    const { raw, hash, prefix } = generateApiKey()

    const key = await prisma.apiKey.create({
      data: {
        account_id: guard.accountId,
        name,
        key_hash: hash,
        key_prefix: prefix,
      },
      select: { id: true, name: true, key_prefix: true, created_at: true },
    })

    // Return the raw key ONLY on creation — it will never be shown again.
    return NextResponse.json({ key, raw }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/api-keys]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
