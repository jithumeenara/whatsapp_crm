import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { checkTemplate, createAtMeta, ensureMessengerTemplatesTable } from '@/lib/meta/messenger-templates'
import { insightAuth } from '@/lib/meta/social-insights'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET  /api/facebook/templates[?refresh=1]  — the workspace's Messenger utility
 *      templates (agent+, to pick one in the Inbox; refresh asks Meta for
 *      approval status, admin+).
 * POST /api/facebook/templates { name, language, body }  — create at Meta (admin+).
 */

type Row = { id: string; name: string; language: string; body: string; param_count: number; status: string; reject_reason: string | null }

export async function GET(req: Request) {
  try {
    const ctx = await requireRole('agent')
    await ensureMessengerTemplatesTable()
    const refresh = new URL(req.url).searchParams.get('refresh') === '1'
    if (refresh && ['admin', 'owner'].includes(ctx.role)) {
      const auth = await insightAuth(ctx.accountId, 'facebook')
      if (auth) {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${auth.nodeId}/message_templates?fields=name,language,status,rejected_reason&limit=200&access_token=${encodeURIComponent(auth.token)}`, { cache: 'no-store' }).catch(() => null)
        const data = (await res?.json().catch(() => null)) as { data?: Array<{ name?: unknown; language?: unknown; status?: unknown; rejected_reason?: unknown }> } | null
        for (const t of data?.data ?? []) {
          if (typeof t.name !== 'string' || typeof t.language !== 'string' || typeof t.status !== 'string') continue
          const reason = typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE' ? t.rejected_reason.slice(0, 120) : null
          await prisma.$executeRaw`
            UPDATE messenger_templates SET status = ${t.status.toLowerCase().slice(0, 20)}, reject_reason = ${reason}, updated_at = now()
            WHERE account_id = ${ctx.accountId}::uuid AND name = ${t.name} AND language = ${t.language}`.catch(() => 0)
        }
      }
    }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id::text AS id, name, language, body, param_count, status, reject_reason
      FROM messenger_templates WHERE account_id = ${ctx.accountId}::uuid ORDER BY created_at DESC LIMIT 200`
    return NextResponse.json({ templates: rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`messenger-template:${ctx.userId}`, RATE_LIMITS.apiWrite)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const t = checkTemplate({ name: body?.name, language: body?.language, body: body?.body })
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 })
    const auth = await insightAuth(ctx.accountId, 'facebook')
    if (!auth) return NextResponse.json({ error: 'Connect the Facebook Page first.' }, { status: 400 })
    await ensureMessengerTemplatesTable()
    const exists = await prisma.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM messenger_templates WHERE account_id = ${ctx.accountId}::uuid AND name = ${t.name} AND language = ${t.language} LIMIT 1`
    if (exists.length) return NextResponse.json({ error: 'A template with this name and language already exists.' }, { status: 409 })

    const r = await createAtMeta(auth.nodeId, auth.token, t)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO messenger_templates (account_id, name, language, body, param_count, status, meta_id, created_by)
      VALUES (${ctx.accountId}::uuid, ${t.name}, ${t.language}, ${t.body}, ${t.params}, ${r.status}, ${r.metaId}, ${ctx.userId}::uuid)
      ON CONFLICT (account_id, name, language) DO NOTHING
      RETURNING id::text AS id`
    await audit(auditCtx(req, ctx), { action: 'record.created', target: { type: 'messenger_template', id: rows[0]?.id ?? null, label: t.name }, meta: { language: t.language, params: t.params } })
    return NextResponse.json({ ok: true, id: rows[0]?.id ?? null, status: r.status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
