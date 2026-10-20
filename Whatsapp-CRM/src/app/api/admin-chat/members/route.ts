import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole, isAccountRole } from '@/lib/auth/roles'
import { requireStepUp, StepUpError } from '@/lib/admin-chat/step-up'
import { writeAudit } from '@/lib/admin-chat/audit'
import { MAX_MEMBERS, hashCode, newVerifyCode } from '@/lib/admin-chat/rules'
import { parseMemberFields, MemberFieldError } from '@/lib/admin-chat/member-fields'

/**
 * POST /api/admin-chat/members — add one admin (at most 5).
 * Body: { user_id, channel, phone?, scope, valid_from, valid_until,
 *         allowed_days, start_minute, end_minute, totp_code }
 * Returns the one-time code the admin sends from that phone / Telegram
 * account to prove it is theirs ("CRM-123456", valid 30 minutes). The code
 * is shown once and only its hash is stored.
 */

const VERIFY_MINUTES = 30

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    await requireStepUp(ctx.userId, body.totp_code)

    const userId = typeof body.user_id === 'string' ? body.user_id : ''
    const channel = body.channel === 'telegram' ? 'telegram' : body.channel === 'whatsapp' ? 'whatsapp' : null
    if (!channel) return NextResponse.json({ error: 'Choose WhatsApp or Telegram.' }, { status: 400 })
    const fields = parseMemberFields(body)

    // Only an owner or admin of this account, with their own authenticator on.
    const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true, account_role: true } })
    if (!profile || profile.account_id !== ctx.accountId) return NextResponse.json({ error: 'Choose a member of your team.' }, { status: 400 })
    if (!isAccountRole(profile.account_role) || !hasMinRole(profile.account_role, 'admin')) {
      return NextResponse.json({ error: 'Admin Chat is for owners and admins.' }, { status: 400 })
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfa_method: true } })
    if (user?.mfa_method !== 'totp') {
      return NextResponse.json({ error: 'This person must turn on the authenticator app for their CRM login first (Profile → Security).' }, { status: 400 })
    }

    let phone: string | null = null
    if (channel === 'whatsapp') {
      const digits = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
      if (digits.length < 10 || digits.length > 15) return NextResponse.json({ error: 'Enter their WhatsApp number with the country code, e.g. 91 98470 12345.' }, { status: 400 })
      phone = digits
    } else {
      const bot = await prisma.telegramBot.findUnique({ where: { account_id: ctx.accountId }, select: { status: true } })
      if (!bot || bot.status === 'disconnected') return NextResponse.json({ error: 'Connect Telegram first (Settings → Channels → Telegram).' }, { status: 400 })
    }

    const count = await prisma.adminChatMember.count({ where: { account_id: ctx.accountId, status: { not: 'disabled' } } })
    if (count >= MAX_MEMBERS) return NextResponse.json({ error: `Admin Chat allows ${MAX_MEMBERS} admins. Remove one first.` }, { status: 400 })

    const code = newVerifyCode()
    let created
    try {
      created = await prisma.adminChatMember.create({
        data: {
          account_id: ctx.accountId,
          user_id: userId,
          channel,
          phone_normalized: phone,
          scope: fields.scope,
          valid_from: fields.validFrom,
          valid_until: fields.validUntil,
          allowed_days: fields.allowedDays,
          start_minute: fields.startMinute,
          end_minute: fields.endMinute,
          verify_code_hash: hashCode(code),
          verify_expires_at: new Date(Date.now() + VERIFY_MINUTES * 60_000),
          created_by: ctx.userId,
        },
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: 'This person or number is already in Admin Chat on that channel.' }, { status: 409 })
      }
      throw err
    }
    await writeAudit({
      accountId: ctx.accountId,
      event: 'member_added',
      memberId: created.id,
      actorUserId: ctx.userId,
      detail: { channel, scope: fields.scope, valid_until: body.valid_until },
    })
    return NextResponse.json({ ok: true, id: created.id, verify_code: `CRM-${code}`, verify_minutes: VERIFY_MINUTES })
  } catch (err) {
    if (err instanceof StepUpError || err instanceof MemberFieldError) return NextResponse.json({ error: err.message }, { status: err.status })
    return toErrorResponse(err)
  }
}
