import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isPlatformOwner } from '@/lib/auth/platform-owner'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * GET   /api/system/errors?show=open|all     Settings → Errors
 * PATCH /api/system/errors   { id, action: 'resolve' }
 *
 * Admins see their own workspace's errors (browser errors from their
 * people). Server-wide errors (account_id NULL) carry internal details of
 * the whole server, so only the server's owner sees or resolves them.
 * Messages were redacted when stored.
 */

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`system-errors:${ctx.userId}`, { limit: 60, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    const showAll = new URL(req.url).searchParams.get('show') === 'all'
    const owner = await isPlatformOwner(ctx.userId)
    const scope = owner
      ? { OR: [{ account_id: ctx.accountId }, { account_id: null }] }
      : { account_id: ctx.accountId }
    const rows = await prisma.appError.findMany({
      where: { ...scope, ...(showAll ? {} : { resolved_at: null }) },
      orderBy: { last_seen: 'desc' },
      take: 100,
      select: { id: true, source: true, where_at: true, message: true, count: true, first_seen: true, last_seen: true, resolved_at: true, account_id: true },
    })
    return NextResponse.json({
      server_owner: owner,
      errors: rows.map((r) => ({ ...r, server_wide: r.account_id === null, account_id: undefined })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!UUID.test(id) || body?.action !== 'resolve') {
      return NextResponse.json({ error: 'Choose an error to mark as resolved.' }, { status: 400 })
    }
    const owner = await isPlatformOwner(ctx.userId)
    const r = await prisma.appError.updateMany({
      where: { id, resolved_at: null, ...(owner ? { OR: [{ account_id: ctx.accountId }, { account_id: null }] } : { account_id: ctx.accountId }) },
      data: { resolved_at: new Date() },
    })
    if (r.count === 0) return NextResponse.json({ error: 'That error was not found or is already resolved.' }, { status: 404 })
    await auditConfigChange(auditCtx(req, ctx), 'config.other_changed', { area: 'app_errors', fields: ['resolved_at'], target: { type: 'app_error', id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
