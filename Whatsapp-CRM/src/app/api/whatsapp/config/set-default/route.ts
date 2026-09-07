import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * POST /api/whatsapp/config/set-default
 * Body: { id } — marks one connected number as the account's default
 * (Finding #14), the fallback used wherever a specific number isn't
 * otherwise resolvable (see src/lib/whatsapp/resolve-config.ts).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const id = typeof body?.id === 'string' ? body.id : undefined
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const target = await prisma.whatsAppConfig.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!target) return NextResponse.json({ error: 'Number not found' }, { status: 404 })

    await prisma.$transaction([
      prisma.whatsAppConfig.updateMany({ where: { account_id: ctx.accountId }, data: { is_default: false } }),
      prisma.whatsAppConfig.update({ where: { id }, data: { is_default: true } }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
