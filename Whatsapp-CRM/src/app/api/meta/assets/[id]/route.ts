import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit } from '@/lib/rate-limit'
import { isAssetKind } from '@/lib/meta/connect-state'
import { checkAsset, removeAsset, setDefaultAsset } from '@/lib/meta/asset-connect'
import { loadMetaAppOnly } from '@/lib/meta/social-connect-server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/meta/assets/[id] — body { kind, action: 'default' | 'check' }.
 * Make this ad account / catalog the default, or re-check it with Meta.
 * Only this workspace's own rows (looked up with account_id).
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as { kind?: unknown; action?: unknown } | null
    const kind = body?.kind
    if (!isAssetKind(kind)) return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 })

    if (body?.action === 'default') {
      const ok = await setDefaultAsset(ctx.accountId, kind, id, ctx.userId)
      if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'meta_asset_connect', fields: [kind], meta: { step: 'default', kind, id } })
      return NextResponse.json({ ok: true })
    }

    if (body?.action === 'check') {
      const limited = checkRateLimit(`meta-asset-check:${ctx.accountId}:${id}`, { limit: 3, windowMs: 60_000 })
      if (!limited.success) return NextResponse.json({ error: 'Checked a moment ago. Try again in a minute.' }, { status: 429 })
      const app = await loadMetaAppOnly()
      if (!app) return NextResponse.json({ error: 'The Meta App is not set up on this server.' }, { status: 400 })
      const ok = await checkAsset(ctx.accountId, kind, id, app)
      if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/meta/assets/[id]?kind= — remove one ad account / catalog from this workspace. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const kind = req.nextUrl.searchParams.get('kind')
    if (!isAssetKind(kind)) return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 })
    const ok = await removeAsset(ctx.accountId, kind, id, ctx.userId)
    if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'meta_asset_connect', fields: [kind], meta: { step: 'removed', kind, id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
