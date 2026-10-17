import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkPing, syncSoon } from '@/lib/google/sheet-two-way'

/**
 * POST /api/google/sheet-ping — the Apps Script in a business's sheet says
 * "this sheet just changed" (sheet-two-way.ts appsScriptFor).
 *
 * Public (proxy.ts), so: POST only, the body must name a link and carry
 * that link's secret, limited per link. It carries no sheet data and can
 * do nothing but bring that one link's sync forward — the CRM then reads
 * the sheet itself with the account's own Google access.
 *
 * Calls come from Google's shared servers, so the limit is per link
 * (an edit burst is several pings; the sync is debounced into one run).
 */

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { link?: unknown; token?: unknown } | null
  const link = typeof body?.link === 'string' ? body.link : ''
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!UUID.test(link) || token.length < 20 || token.length > 100) {
    return NextResponse.json({ error: 'Not a sheet link.' }, { status: 400 })
  }
  const limited = checkRateLimit(`sheet-ping:${link}`, { limit: 60, windowMs: 60_000 })
  if (!limited.success) return NextResponse.json({ error: 'Too many changes at once — the sync will catch up.' }, { status: 429 })

  const check = await checkPing(link, token)
  if (!check.ok || !check.accountId) return NextResponse.json({ error: 'Not a sheet link.' }, { status: 404 })

  syncSoon(link, check.accountId, 2000)
  await prisma.googleSheetLink.update({ where: { id: link }, data: { instant_ping_at: new Date() } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
