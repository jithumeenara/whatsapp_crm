import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { insightAuth } from '@/lib/meta/social-insights'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'

/**
 * DELETE /api/facebook/templates/[id] — remove a Messenger template (admin+):
 * at Meta (best effort) and from this workspace's list. Only this
 * workspace's row (loaded with the account id).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM messenger_templates WHERE id = ${id}::uuid AND account_id = ${ctx.accountId}::uuid LIMIT 1`.catch(() => [])
    const row = rows[0]
    if (!row) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    const auth = await insightAuth(ctx.accountId, 'facebook')
    if (auth && /^[a-z0-9_]{1,512}$/.test(row.name)) {
      await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${auth.nodeId}/message_templates?name=${encodeURIComponent(row.name)}&access_token=${encodeURIComponent(auth.token)}`, { method: 'DELETE' })
        .catch((e: unknown) => console.warn('[messenger templates] Meta delete skipped:', e instanceof Error ? e.message : e))
    }
    await prisma.$executeRaw`DELETE FROM messenger_templates WHERE id = ${id}::uuid AND account_id = ${ctx.accountId}::uuid`
    await audit(auditCtx(req, ctx), { action: 'record.deleted', target: { type: 'messenger_template', id, label: row.name } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
