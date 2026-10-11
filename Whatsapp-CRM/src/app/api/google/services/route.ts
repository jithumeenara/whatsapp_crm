import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { loadGoogleConnection, logGoogleActivity } from '@/lib/google/oauth'
import { isServiceId, serviceById } from '@/lib/google/services'

/**
 * Switch one service on or off without Google's consent screen.
 *
 * Off: always possible — the CRM stops using it. Google has no way to
 * revoke one scope of a grant, so the permission stays with the account
 * until the whole Google account is disconnected; the card says so.
 * On: only when its scopes are already granted (Drive shares Sheets'
 * scope, say). Otherwise the hub sends the person through Connect.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { service?: unknown; enabled?: unknown }
    if (!isServiceId(body.service) || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'service and enabled are required.' }, { status: 400 })
    }
    const svc = serviceById(body.service)!
    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn || conn.status !== 'connected') return NextResponse.json({ error: 'Connect a Google account first.' }, { status: 400 })

    if (body.enabled) {
      if (svc.availability !== 'available') return NextResponse.json({ error: `${svc.name} is not available yet.` }, { status: 400 })
      if (!svc.scopes.every((s) => conn.granted_scopes.includes(s))) {
        return NextResponse.json({ error: 'needs_consent', needs_consent: true }, { status: 409 })
      }
    }
    const enabled = body.enabled
      ? [...new Set([...conn.enabled_services, svc.id])]
      : conn.enabled_services.filter((id) => id !== svc.id)
    await prisma.googleConnection.update({
      where: { id: conn.id },
      data: {
        enabled_services: enabled,
        // Full inbox switched back on: from now, not everything since it was off.
        ...(svc.id === 'gmail_inbox' && body.enabled ? { gmail_history_id: null } : {}),
      },
    })
    await logGoogleActivity(ctx.accountId, ctx.userId, body.enabled ? 'service_on' : 'service_off', svc.name)
    return NextResponse.json({ ok: true, enabled_services: enabled })
  } catch (err) {
    return toErrorResponse(err)
  }
}
