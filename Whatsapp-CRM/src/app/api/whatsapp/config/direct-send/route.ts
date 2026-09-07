import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * POST /api/whatsapp/config/direct-send
 * Body: { id, enabled } — toggles Finding #08b's Direct Send flag for
 * one number. Never calls Meta — this only changes which code path
 * this account's sends take; it matters only once Meta has separately
 * granted partner-manager approval for the real Direct Send beta.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const id = typeof body?.id === 'string' ? body.id : undefined
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined
    if (!id || enabled === undefined) {
      return NextResponse.json({ error: 'id and enabled are required' }, { status: 400 })
    }

    const target = await prisma.whatsAppConfig.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!target) return NextResponse.json({ error: 'Number not found' }, { status: 404 })

    await prisma.whatsAppConfig.update({ where: { id }, data: { direct_send_enabled: enabled } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
