import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { claimAssetSession, MAX_ASSETS, readAssetChoices, saveAssets } from '@/lib/meta/asset-connect'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^\d{1,30}$/

/** GET /api/meta/assets/finish?session= — the ad accounts / catalogs to choose from (no token). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const id = req.nextUrl.searchParams.get('session') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown session.' }, { status: 400 })
    const choices = await readAssetChoices(id, ctx.accountId, ctx.userId)
    if (!choices) return NextResponse.json({ error: 'This choice has expired. Press Connect again.' }, { status: 410 })
    return NextResponse.json(choices)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/meta/assets/finish — body { session, ids: string[] }. Only ids
 * offered in this owner's own session are accepted; the session works once.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { session?: unknown; ids?: unknown } | null
    const id = typeof body?.session === 'string' ? body.session : ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown session.' }, { status: 400 })
    const raw = Array.isArray(body?.ids) ? body.ids : []
    if (raw.length === 0 || raw.length > MAX_ASSETS || !raw.every((v) => typeof v === 'string' && ID.test(v))) {
      return NextResponse.json({ error: 'Choose at least one.' }, { status: 400 })
    }
    const ids = [...new Set(raw as string[])]

    const session = await claimAssetSession(id, ctx.accountId, ctx.userId)
    if (!session) return NextResponse.json({ error: 'This choice has expired or was already used. Press Connect again.' }, { status: 410 })

    // Only what this session offered — never an id from the request alone.
    const chosen = session.assets.filter((a) => ids.includes(a.id))
    if (chosen.length !== ids.length) {
      return NextResponse.json({ error: 'Something you chose was not part of this connection. Press Connect again.' }, { status: 400 })
    }
    const { saved } = await saveAssets({ accountId: ctx.accountId, userId: ctx.userId, kind: session.kind, token: session.token, scopes: session.scopes, assets: chosen })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
      area: 'meta_asset_connect', fields: [session.kind], meta: { step: 'connected', kind: session.kind, ids: chosen.map((a) => a.id) },
    })
    return NextResponse.json({ saved, kind: session.kind })
  } catch (err) {
    return toErrorResponse(err)
  }
}
