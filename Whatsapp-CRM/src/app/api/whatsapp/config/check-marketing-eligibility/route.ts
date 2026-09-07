import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkMarketingMessagesEligibility } from '@/lib/whatsapp/marketing-messages-api'

/**
 * POST /api/whatsapp/config/check-marketing-eligibility
 * Body: { id } — refreshes one number's Marketing Messages eligibility
 * (Finding #10) against Meta and stores the raw status. Self-serve —
 * confirmed no manual Meta review is required, unlike Direct Send/UPI
 * payments elsewhere in this feature set.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const id = typeof body?.id === 'string' ? body.id : undefined
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const config = await prisma.whatsAppConfig.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!config) return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    if (!config.waba_id) return NextResponse.json({ error: 'This number has no WABA ID on file.' }, { status: 400 })

    let status: string | null
    try {
      const result = await checkMarketingMessagesEligibility({ wabaId: config.waba_id, accessToken: decrypt(config.access_token) })
      status = result.status
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Eligibility check failed.' }, { status: 502 })
    }

    await prisma.whatsAppConfig.update({ where: { id }, data: { marketing_messages_status: status } })

    return NextResponse.json({ success: true, status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
