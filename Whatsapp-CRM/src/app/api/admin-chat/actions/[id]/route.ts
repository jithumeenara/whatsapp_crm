import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { requireStepUp, StepUpError } from '@/lib/admin-chat/step-up'
import { executeAction } from '@/lib/admin-chat/actions'
import { writeAudit } from '@/lib/admin-chat/audit'
import { sendToAdmin } from '@/lib/admin-chat/brief-sweep'

/**
 * POST /api/admin-chat/actions/[id] — Settings → Admin Chat → Waiting for approval.
 * { decision: 'approve', totp_code } runs it; { decision: 'reject' } drops it.
 *
 * Who may approve: the admin who asked (a template to one customer, a
 * broadcast draft up to 50 people) — or, for a broadcast to more than 50,
 * a DIFFERENT owner/admin. Approving needs the approver's authenticator
 * code; rejecting never does.
 */

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const action = await prisma.adminChatAction.findFirst({ where: { id, account_id: ctx.accountId, status: 'awaiting_web' } })
    if (!action) return NextResponse.json({ error: 'This request is no longer waiting.' }, { status: 404 })
    if (action.expires_at <= new Date()) {
      await prisma.adminChatAction.updateMany({ where: { id: action.id, status: 'awaiting_web' }, data: { status: 'expired' } })
      return NextResponse.json({ error: 'This request expired. Ask again in the chat.' }, { status: 410 })
    }
    const body = (await req.json().catch(() => ({}))) as { decision?: unknown; totp_code?: unknown }
    const member = await prisma.adminChatMember.findUnique({ where: { id: action.member_id } })
    const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: ctx.accountId } })

    if (body.decision === 'reject') {
      const r = await prisma.adminChatAction.updateMany({ where: { id: action.id, status: 'awaiting_web' }, data: { status: 'rejected', approved_by: ctx.userId } })
      if (r.count === 0) return NextResponse.json({ error: 'Already handled.' }, { status: 409 })
      await writeAudit({ accountId: ctx.accountId, event: 'action_rejected', memberId: action.member_id, actorUserId: ctx.userId, detail: { kind: action.kind, summary: action.summary } })
      if (member && settings) {
        void sendToAdmin(member, settings, `✋ Not done: ${action.summary} — rejected in the CRM.`, `${action.summary} was rejected`, new Date()).catch(() => {})
      }
      return NextResponse.json({ ok: true })
    }
    if (body.decision !== 'approve') return NextResponse.json({ error: 'Approve or reject.' }, { status: 400 })

    if (action.needs_other_approver && action.requested_by === ctx.userId) {
      return NextResponse.json({ error: 'This one reaches more than 50 people — another owner or admin must approve it.' }, { status: 403 })
    }
    if (!action.needs_other_approver && action.requested_by !== ctx.userId) {
      return NextResponse.json({ error: 'Only the admin who asked for this can confirm it.' }, { status: 403 })
    }
    await requireStepUp(ctx.userId, body.totp_code)

    const done = await executeAction(action.id, ctx.userId, ['awaiting_web'])
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: 409 })
    if (member && settings) {
      const line = action.kind === 'prepare_broadcast' ? `${action.summary} — the draft is on the Broadcasts page to review and send.` : action.summary
      void sendToAdmin(member, settings, `✅ Done: ${line}`, `${action.summary} is done`, new Date()).catch(() => {})
    }
    return NextResponse.json({ ok: true, summary: done.summary })
  } catch (err) {
    if (err instanceof StepUpError) return NextResponse.json({ error: err.message }, { status: err.status })
    return toErrorResponse(err)
  }
}
