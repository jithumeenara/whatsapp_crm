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

/** POST /api/meta-ads/lead-forms — { meta_form_id, name, page_id } —
 *  proactively enable syncing for a form found via the discover
 *  endpoint, before it has ever produced a submission. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    const { meta_form_id, name, page_id } = await req.json().catch(() => ({}))
    if (!meta_form_id || !page_id) {
      return NextResponse.json({ error: 'meta_form_id and page_id are required' }, { status: 400 })
    }

    const form = await prisma.leadAdForm.upsert({
      where: { meta_form_id },
      create: { account_id: accountId, meta_form_id, page_id, name: name || `Form ${meta_form_id}`, is_active: true },
      update: { is_active: true },
    })

    return NextResponse.json({ form })
  } catch (error) {
    console.error('Error in Lead Ads forms POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** PATCH /api/meta-ads/lead-forms — { id | meta_form_id, name?, is_active? } —
 *  either identifier works, since the discover screen only ever has the
 *  Meta-side form ID for a form it hasn't loaded a CRM row for yet. */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

    const { id, meta_form_id, name, is_active } = await req.json().catch(() => ({}))
    if (!id && !meta_form_id) return NextResponse.json({ error: 'id or meta_form_id is required' }, { status: 400 })

    const existing = await prisma.leadAdForm.findFirst({
      where: id ? { id, account_id: accountId } : { meta_form_id, account_id: accountId },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const form = await prisma.leadAdForm.update({
      where: { id: existing.id },
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
