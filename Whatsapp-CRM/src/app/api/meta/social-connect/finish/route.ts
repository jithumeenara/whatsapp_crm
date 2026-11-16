import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { saveSocialConnection } from '@/lib/meta/social-connect'
import { claimConnectSession, loadSocialApp, readConnectChoices } from '@/lib/meta/social-connect-server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC_ID = /^\d{1,30}$/

/** GET /api/meta/social-connect/finish?session= — the Pages and accounts to choose from (no tokens). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const id = req.nextUrl.searchParams.get('session') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown session.' }, { status: 400 })
    const choices = await readConnectChoices(id, ctx.accountId, ctx.userId)
    if (!choices) return NextResponse.json({ error: 'This choice has expired. Press Connect again.' }, { status: 410 })
    return NextResponse.json(choices)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/meta/social-connect/finish — body { session, page_id, instagram_id }
 * (either may be null). Only ids offered in this owner's own session are
 * accepted; the session is used once.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const body = (await req.json().catch(() => null)) as { session?: unknown; page_id?: unknown; instagram_id?: unknown } | null
    const id = typeof body?.session === 'string' ? body.session : ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown session.' }, { status: 400 })
    const pageId = typeof body?.page_id === 'string' && NUMERIC_ID.test(body.page_id) ? body.page_id : null
    const igId = typeof body?.instagram_id === 'string' && NUMERIC_ID.test(body.instagram_id) ? body.instagram_id : null
    if (!pageId && !igId) return NextResponse.json({ error: 'Choose a Facebook Page, an Instagram account, or both.' }, { status: 400 })

    const app = await loadSocialApp()
    if (!app) return NextResponse.json({ error: 'The Meta App is not set up on this server.' }, { status: 400 })

    const session = await claimConnectSession(id, ctx.accountId, ctx.userId)
    if (!session) return NextResponse.json({ error: 'This choice has expired or was already used. Press Connect again.' }, { status: 410 })

    // Only what this session offered — never an id from the request alone.
    const page = pageId ? session.pages.find((p) => p.id === pageId && p.token) ?? null : null
    const instagram = igId ? session.instagram.find((i) => i.id === igId) ?? null : null
    if ((pageId && !page) || (igId && !instagram)) {
      return NextResponse.json({ error: 'That Page or account was not part of this connection. Press Connect again.' }, { status: 400 })
    }

    const saved = await saveSocialConnection({ accountId: ctx.accountId, token: session.token, app, page, instagram, scopes: session.scopes, expiresAt: session.expiresAt })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
      area: 'meta_social_connect',
      fields: [...(saved.facebook?.connected ? ['facebook'] : []), ...(saved.instagram?.connected ? ['instagram'] : [])],
      meta: { step: 'connected', via: 'login', page_id: page?.id ?? null, instagram_id: instagram?.id ?? null },
    })
    return NextResponse.json(saved)
  } catch (err) {
    return toErrorResponse(err)
  }
}
