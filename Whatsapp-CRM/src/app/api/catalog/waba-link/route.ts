import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit } from '@/lib/rate-limit'
import { linkCatalogToWaba, wabaCatalogOverview } from '@/lib/catalog/for-number'

/**
 * GET /api/catalog/waba-link — this workspace's WhatsApp accounts (numbers
 * shown by label), the catalog each one uses, and the connected catalogs to
 * choose from. Owner only; no tokens, no other workspace's data.
 */
export async function GET() {
  try {
    const ctx = await requireRole('owner')
    const [wabas, catalogs] = await Promise.all([
      wabaCatalogOverview(ctx.accountId),
      prisma.metaCatalog.findMany({ where: { account_id: ctx.accountId }, select: { catalog_id: true, name: true, is_default: true }, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] }),
    ])
    return NextResponse.json({ wabas, catalogs: catalogs.map((c) => ({ id: c.catalog_id, name: c.name, isDefault: c.is_default })) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/catalog/waba-link — body { waba_id, catalog_id, catalog_visible, cart_enabled }.
 * Links a connected catalog to one of this workspace's WhatsApp accounts at
 * Meta (one catalog per WhatsApp account). Owner only, rate-limited, audited.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const limited = checkRateLimit(`waba-link:${ctx.accountId}`, { limit: 10, windowMs: 10 * 60_000 })
    if (!limited.success) return NextResponse.json({ error: 'Too many changes. Wait a few minutes and try again.' }, { status: 429 })
    const body = (await req.json().catch(() => null)) as { waba_id?: unknown; catalog_id?: unknown; catalog_visible?: unknown; cart_enabled?: unknown } | null
    const wabaId = typeof body?.waba_id === 'string' ? body.waba_id : ''
    const catalogId = typeof body?.catalog_id === 'string' ? body.catalog_id : ''
    if (!/^\d{1,30}$/.test(wabaId) || !/^\d{1,30}$/.test(catalogId)) return NextResponse.json({ error: 'Choose a WhatsApp account and a catalog.' }, { status: 400 })
    if (typeof body?.catalog_visible !== 'boolean' || typeof body?.cart_enabled !== 'boolean') return NextResponse.json({ error: 'Choose whether to show the catalog and the cart.' }, { status: 400 })

    const result = await linkCatalogToWaba({ accountId: ctx.accountId, userId: ctx.userId, wabaId, catalogId, catalogVisible: body.catalog_visible, cartEnabled: body.cart_enabled })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'waba_catalog', fields: ['catalog_id'], meta: { waba_id: wabaId, catalog_id: catalogId, ok: result.ok } })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
