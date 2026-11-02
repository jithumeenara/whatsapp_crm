import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { buildWidgetPatch } from '@/lib/webchat/widget-patch'
import type { Prisma } from '@prisma/client'

/**
 * One website chat widget. Admins only.
 *
 * PATCH   any editable field.
 * DELETE  removes the widget and its visitor sessions; the conversations
 *         and contacts it created stay, as every channel's do.
 *
 * Both are scoped by account in the WHERE clause itself (updateMany /
 * deleteMany), so an id from another account matches nothing rather
 * than being checked and then trusted.
 */

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = await buildWidgetPatch(ctx.accountId, body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { count } = await prisma.webChatWidget.updateMany({
      where: { id, account_id: ctx.accountId },
      data: parsed.patch as Prisma.WebChatWidgetUpdateManyMutationInput,
    })
    if (count === 0) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
      area: 'website_chat_widget',
      fields: Object.keys(parsed.patch as Record<string, unknown>),
      target: { type: 'webchat_widget', id },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { count } = await prisma.webChatWidget.deleteMany({ where: { id, account_id: ctx.accountId } })
    if (count === 0) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
      area: 'website_chat_widget',
      fields: [],
      target: { type: 'webchat_widget', id },
      meta: { removed: true },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
