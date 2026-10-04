import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { checkSpec, loadContext, parseSpec, ReportError } from '@/lib/reports/engine'
import { countSaved, createSaved, deleteSaved, listSaved, MAX_SAVED } from '@/lib/reports/store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET /api/reports/saved — this account's saved report sentences. */
export async function GET() {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const saved = await listSaved(ctx.accountId)
    return NextResponse.json({ saved: saved.map((s) => ({ id: s.id, name: s.name, spec: s.spec, updated_at: s.updated_at })) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/reports/saved   { name, spec } — checked against this
 *  account's moments before it is stored, so a saved report always opens. */
export async function POST(request: Request) {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const limited = checkRateLimit(`report-save:${ctx.userId}`, { limit: 30, windowMs: 60_000 })
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => null)) as { name?: unknown; spec?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) return NextResponse.json({ error: 'Give the report a name of up to 80 characters.' }, { status: 400 })

    const spec = parseSpec(body?.spec)
    const rc = await loadContext(ctx.accountId)
    checkSpec(spec, rc.store)

    if ((await countSaved(ctx.accountId)) >= MAX_SAVED) {
      return NextResponse.json({ error: `An account can keep up to ${MAX_SAVED} saved reports. Delete one first.` }, { status: 400 })
    }
    const id = await createSaved(ctx.accountId, ctx.userId, name, spec)
    return NextResponse.json({ id })
  } catch (err) {
    if (err instanceof ReportError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}

/** DELETE /api/reports/saved?id=... */
export async function DELETE(request: Request) {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown report.' }, { status: 400 })
    const removed = await deleteSaved(ctx.accountId, id)
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Unknown report.' }, { status: 404 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
