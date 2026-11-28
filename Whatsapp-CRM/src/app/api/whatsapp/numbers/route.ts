import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { numberHealth } from '@/lib/whatsapp/number-health'
import { coexistenceSyncState } from '@/lib/whatsapp/coexistence'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * GET /api/whatsapp/numbers — every connected WhatsApp number of this
 * workspace with its live health from Meta (number-health.ts) and, for a
 * WhatsApp Business app number, how far the chat import got.
 *
 * Owner only, like the rest of Settings → Channels. Never returns a token.
 * ?fresh=1 skips the 5-minute cache (rate-limited).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    // ?lite=1 — names only, for the Inbox number filter: any member, no Meta call, no token.
    if (new URL(request.url).searchParams.get('lite') === '1') {
      const member = await requireRole('agent')
      const rows = await prisma.whatsAppConfig.findMany({
        where: { account_id: member.accountId },
        select: { id: true, label: true, phone_number_id: true, is_default: true },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
        take: 50,
      })
      return NextResponse.json({
        numbers: rows.map((r, i) => ({ id: r.id, name: r.label || `Number ${i + 1}`, is_default: r.is_default })),
      })
    }
    const ctx = await requireRole('owner')
    const fresh = new URL(request.url).searchParams.get('fresh') === '1'
      && checkRateLimit(`wa-numbers-fresh:${ctx.userId}`, { limit: 6, windowMs: 60_000 }).success
    const rows = await prisma.whatsAppConfig.findMany({
      where: { account_id: ctx.accountId },
      select: {
        id: true, phone_number_id: true, waba_id: true, access_token: true, status: true, label: true,
        is_default: true, connect_method: true, connected_at: true, last_registration_error: true,
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      take: 50,
    })
    const numbers = await Promise.all(rows.map(async (r) => {
      let token: string | null = null
      try { token = decrypt(r.access_token) } catch { token = null }
      const health = token ? await numberHealth(r.phone_number_id, token, { fresh }) : null
      const coexistence = r.connect_method === 'coexistence' ? await coexistenceSyncState(r.id, ctx.accountId) : null
      return {
        id: r.id,
        phone_number_id: r.phone_number_id,
        label: r.label,
        is_default: r.is_default,
        status: r.status,
        connect_method: r.connect_method,
        connected_at: r.connected_at?.toISOString() ?? null,
        problem: r.last_registration_error,
        token_ok: Boolean(token),
        health,
        coexistence,
      }
    }))
    // The portfolio's shared limit: the same on every number, shown once.
    const limit = numbers.map((n) => n.health?.messaging_limit).find(Boolean) ?? null
    return NextResponse.json({ numbers, messaging_limit: limit })
  } catch (err) {
    return toErrorResponse(err)
  }
}
