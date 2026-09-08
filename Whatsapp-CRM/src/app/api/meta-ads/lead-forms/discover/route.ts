import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fetchLeadForms } from '@/lib/meta-ads/api'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type FbConfigRow = { access_token: string | null; page_id: string | null }

/**
 * GET /api/meta-ads/lead-forms/discover
 *
 * Browse every Instant Form on the connected Facebook Page, not just the
 * ones that already have a submission — fetchLeadForms existed in
 * lib/meta-ads/api.ts since the first Lead Ads pass but nothing ever
 * called it, so forms only ever showed up reactively (the first time
 * someone submitted one). Uses the Facebook Page's own access token
 * (facebook_config), since Lead Ads forms live on the Page, not the WABA.
 */
export async function GET() {
  try {
    // Read-only — found with no role floor at all in the full-app audit.
    const { accountId } = await requireRole('viewer')

    const rows = await prisma.$queryRaw<FbConfigRow[]>`
      SELECT access_token, page_id FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
    `.catch(() => [] as FbConfigRow[])
    const fb = rows[0]
    if (!fb?.page_id || !fb.access_token) {
      return NextResponse.json({ discoverable: false, reason: 'Connect Facebook (Settings → Channels) first — Lead Ads forms live on your Page, not your WhatsApp number.' })
    }

    let metaForms
    try {
      metaForms = await fetchLeadForms({ pageId: fb.page_id, accessToken: fb.access_token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list forms from Meta'
      return NextResponse.json({ discoverable: false, reason: message })
    }

    const tracked = await prisma.leadAdForm.findMany({
      where: { account_id: accountId, meta_form_id: { in: metaForms.map((f) => f.id) } },
      include: { _count: { select: { submissions: true } } },
    })
    const trackedById = new Map(tracked.map((t) => [t.meta_form_id, t]))

    return NextResponse.json({
      discoverable: true,
      page_id: fb.page_id,
      forms: metaForms.map((f) => {
        const t = trackedById.get(f.id)
        return {
          meta_form_id: f.id,
          name: f.name,
          tracked: !!t,
          is_active: t?.is_active ?? false,
          submission_count: t?._count.submissions ?? 0,
        }
      }),
    })
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 401 || status === 403) return toErrorResponse(error)
    console.error('Error in Lead Ads forms discover GET:', error)
    return NextResponse.json({ discoverable: false, reason: 'Internal server error' }, { status: 500 })
  }
}
