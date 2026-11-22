import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAssetKind } from '@/lib/meta/connect-state'
import { listAssets } from '@/lib/meta/asset-connect'
import { socialConnectReady } from '@/lib/meta/social-connect-server'

/**
 * GET /api/meta/assets?kind=ads|catalog — this workspace's connected ad
 * accounts or catalogs (names, ids, health; never a token) and whether the
 * server has the one-click configuration for that kind.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const kind = req.nextUrl.searchParams.get('kind')
    if (!isAssetKind(kind)) return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 })
    const [items, ready] = await Promise.all([listAssets(ctx.accountId, kind), socialConnectReady()])
    return NextResponse.json({ kind, oneClickReady: ready[kind], items })
  } catch (err) {
    return toErrorResponse(err)
  }
}
