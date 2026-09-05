import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  return profile?.account_id ?? null
}

/** GET /api/meta-ads/lead-forms — every Instant Form that has ever
 *  produced a submission for this account, newest first, with a real
 *  submission count (forms are discovered lazily, the first time their
 *  webhook fires — there's no "browse all your Page's forms" call here,
 *  since that needs the same leads_retrieval permission the webhook
 *  itself needs). */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    const forms = await prisma.leadAdForm.findMany({
      where: { account_id: accountId },
      include: { _count: { select: { submissions: true } } },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({
      forms: forms.map((f) => ({
        id: f.id,
        name: f.name,
        page_id: f.page_id,
        is_active: f.is_active,
        submission_count: f._count.submissions,
        created_at: f.created_at,
      })),
    })
  } catch (error) {
    console.error('Error in Lead Ads forms GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PATCH /api/meta-ads/lead-forms — { id, name?, is_active? } */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    const { id, name, is_active } = await req.json().catch(() => ({}))
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const existing = await prisma.leadAdForm.findFirst({ where: { id, account_id: accountId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const form = await prisma.leadAdForm.update({
      where: { id },
      data: {
        ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
        ...(typeof is_active === 'boolean' ? { is_active } : {}),
      },
    })

    return NextResponse.json({ form })
  } catch (error) {
    console.error('Error in Lead Ads forms PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
