import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseWidgetPatch } from '@/lib/webchat/settings'

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
    const parsed = parseWidgetPatch(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { count } = await prisma.webChatWidget.updateMany({
      where: { id, account_id: ctx.accountId },
      data: parsed.patch,
    })
    if (count === 0) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { count } = await prisma.webChatWidget.deleteMany({ where: { id, account_id: ctx.accountId } })
    if (count === 0) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
