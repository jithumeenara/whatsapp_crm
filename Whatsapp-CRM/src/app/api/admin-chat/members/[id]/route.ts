import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { requireStepUp, StepUpError } from '@/lib/admin-chat/step-up'
import { writeAudit } from '@/lib/admin-chat/audit'
import { hashCode, newVerifyCode } from '@/lib/admin-chat/rules'
import { parseMemberFields, MemberFieldError } from '@/lib/admin-chat/member-fields'

/**
 * PATCH  /api/admin-chat/members/[id]
 *        { action: 'new_code', totp_code } — a fresh enrolment code (pending only)
 *        { scope, valid_from, valid_until, allowed_days, start_minute, end_minute, totp_code }
 * DELETE /api/admin-chat/members/[id] — removed from Admin Chat at once;
 *        open sessions end. No code needed: taking access away is always allowed.
 */

const VERIFY_MINUTES = 30

async function load(accountId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return prisma.adminChatMember.findFirst({ where: { id, account_id: accountId, status: { not: 'disabled' } } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const member = await load(ctx.accountId, id)
    if (!member) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    await requireStepUp(ctx.userId, body.totp_code)

    if (body.action === 'new_code') {
      if (member.status !== 'pending') return NextResponse.json({ error: 'This admin is already verified.' }, { status: 400 })
      const code = newVerifyCode()
      await prisma.adminChatMember.update({
        where: { id: member.id },
        data: { verify_code_hash: hashCode(code), verify_expires_at: new Date(Date.now() + VERIFY_MINUTES * 60_000) },
      })
      return NextResponse.json({ ok: true, verify_code: `CRM-${code}`, verify_minutes: VERIFY_MINUTES })
    }

    const fields = parseMemberFields(body)
    await prisma.adminChatMember.update({
      where: { id: member.id },
      data: {
        scope: fields.scope,
        valid_from: fields.validFrom,
        valid_until: fields.validUntil,
        allowed_days: fields.allowedDays,
        start_minute: fields.startMinute,
        end_minute: fields.endMinute,
      },
    })
    await writeAudit({
      accountId: ctx.accountId,
      event: 'member_changed',
      memberId: member.id,
      actorUserId: ctx.userId,
      detail: { scope: fields.scope, valid_until: body.valid_until, days: fields.allowedDays, start: fields.startMinute, end: fields.endMinute },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof StepUpError || err instanceof MemberFieldError) return NextResponse.json({ error: err.message }, { status: err.status })
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const member = await load(ctx.accountId, id)
    if (!member) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await prisma.$transaction([
      prisma.adminChatMember.update({ where: { id: member.id }, data: { status: 'disabled', verify_code_hash: null } }),
      prisma.adminChatSession.updateMany({
        where: { member_id: member.id, state: { not: 'ended' } },
        data: { state: 'ended', ended_at: new Date(), end_reason: 'removed', history: [] },
      }),
    ])
    await writeAudit({ accountId: ctx.accountId, event: 'member_disabled', memberId: member.id, actorUserId: ctx.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
