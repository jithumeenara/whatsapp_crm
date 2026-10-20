import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { requireStepUp, StepUpError } from '@/lib/admin-chat/step-up'
import { writeAudit, verifyAuditChain } from '@/lib/admin-chat/audit'
import { MAX_MEMBERS } from '@/lib/admin-chat/rules'
import { businessTimezone } from '@/lib/ai/human-date'

/**
 * Settings → Admin Chat. Owners and admins only.
 *
 * GET   settings, members, open sessions, the last 50 audit rows and
 *       whether the audit chain is intact, plus who can be added.
 * PUT   { enabled?, keyword?, idle_minutes?, max_minutes?, totp_code }
 *       — needs the caller's authenticator code.
 */

export const dynamic = 'force-dynamic'

const KEYWORD = /^[A-Za-z0-9]{3,20}$/

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const [settings, members, sessions, audit, people, waNumbers, bot, zone, chain] = await Promise.all([
      prisma.adminChatSettings.findUnique({ where: { account_id: ctx.accountId } }),
      prisma.adminChatMember.findMany({ where: { account_id: ctx.accountId, status: { not: 'disabled' } }, orderBy: { created_at: 'asc' } }),
      prisma.adminChatSession.findMany({
        where: { account_id: ctx.accountId, state: { not: 'ended' } },
        select: { id: true, member_id: true, channel: true, state: true, started_at: true, last_activity_at: true, questions: true },
      }),
      prisma.adminChatAudit.findMany({
        where: { account_id: ctx.accountId },
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, event: true, member_id: true, detail: true, created_at: true },
      }),
      prisma.profile.findMany({
        where: { account_id: ctx.accountId, account_role: { in: ['owner', 'admin'] } },
        select: { user_id: true, full_name: true, account_role: true, phone: true, user: { select: { email: true, mfa_method: true } } },
      }),
      prisma.whatsAppConfig.findMany({ where: { account_id: ctx.accountId, status: 'connected' }, select: { label: true } }),
      prisma.telegramBot.findUnique({ where: { account_id: ctx.accountId }, select: { username: true, status: true } }),
      businessTimezone(ctx.accountId),
      verifyAuditChain(ctx.accountId),
    ])
    const nameOf = new Map(people.map((p) => [p.user_id, p.full_name || p.user?.email || 'Team member']))
    return NextResponse.json({
      settings: {
        enabled: settings?.enabled ?? false,
        keyword: settings?.keyword ?? 'ADMIN',
        idle_minutes: settings?.idle_minutes ?? 15,
        max_minutes: settings?.max_minutes ?? 60,
      },
      timezone: zone,
      max_members: MAX_MEMBERS,
      me_has_totp: people.find((p) => p.user_id === ctx.userId)?.user?.mfa_method === 'totp',
      channels: {
        whatsapp: waNumbers.length > 0 ? { labels: waNumbers.map((w) => w.label).filter(Boolean) } : null,
        telegram: bot && bot.status !== 'disconnected' ? { username: bot.username } : null,
      },
      members: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        name: nameOf.get(m.user_id) ?? 'Former team member',
        channel: m.channel,
        phone: m.phone_normalized,
        telegram_linked: Boolean(m.telegram_id),
        status: m.status,
        scope: m.scope,
        valid_from: m.valid_from.toISOString().slice(0, 10),
        valid_until: m.valid_until.toISOString().slice(0, 10),
        allowed_days: m.allowed_days,
        start_minute: m.start_minute,
        end_minute: m.end_minute,
        verify_pending: m.status === 'pending',
        verify_expires_at: m.verify_expires_at,
        locked_until: m.locked_until,
        mfa_ready: people.find((p) => p.user_id === m.user_id)?.user?.mfa_method === 'totp',
      })),
      sessions: sessions.map((s) => ({ ...s, name: nameOf.get(members.find((m) => m.id === s.member_id)?.user_id ?? '') ?? '—' })),
      audit: audit.map((a) => ({
        id: a.id.toString(),
        event: a.event,
        name: nameOf.get(members.find((m) => m.id === a.member_id)?.user_id ?? '') ?? null,
        detail: a.detail,
        created_at: a.created_at,
      })),
      audit_chain: chain,
      candidates: people.map((p) => ({
        user_id: p.user_id,
        name: p.full_name || p.user?.email || 'Team member',
        role: p.account_role,
        phone: p.phone,
        mfa_ready: p.user?.mfa_method === 'totp',
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const data: { enabled?: boolean; keyword?: string; idle_minutes?: number; max_minutes?: number } = {}
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false.' }, { status: 400 })
      data.enabled = body.enabled
    }
    if (body.keyword !== undefined) {
      const k = typeof body.keyword === 'string' ? body.keyword.trim() : ''
      if (!KEYWORD.test(k)) return NextResponse.json({ error: 'The keyword must be 3–20 letters or digits, no spaces.' }, { status: 400 })
      data.keyword = k.toUpperCase()
    }
    for (const [key, min, max] of [['idle_minutes', 5, 60], ['max_minutes', 10, 240]] as const) {
      if (body[key] !== undefined) {
        const n = Number(body[key])
        if (!Number.isInteger(n) || n < min || n > max) return NextResponse.json({ error: `${key === 'idle_minutes' ? 'Idle time' : 'Session length'} must be ${min}–${max} minutes.` }, { status: 400 })
        data[key] = n
      }
    }
    const idle = data.idle_minutes ?? (await prisma.adminChatSettings.findUnique({ where: { account_id: ctx.accountId }, select: { idle_minutes: true } }))?.idle_minutes ?? 15
    const maxM = data.max_minutes ?? (await prisma.adminChatSettings.findUnique({ where: { account_id: ctx.accountId }, select: { max_minutes: true } }))?.max_minutes ?? 60
    if (idle > maxM) return NextResponse.json({ error: 'Idle time cannot be longer than the session length.' }, { status: 400 })
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })

    // Switching off is always allowed without a code; anything else needs one.
    const onlyTurningOff = Object.keys(data).length === 1 && data.enabled === false
    if (!onlyTurningOff) await requireStepUp(ctx.userId, body.totp_code)

    await prisma.adminChatSettings.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, updated_by: ctx.userId, ...data },
      update: { ...data, updated_by: ctx.userId },
    })
    if (data.enabled === false) {
      await prisma.adminChatSession.updateMany({
        where: { account_id: ctx.accountId, state: { not: 'ended' } },
        data: { state: 'ended', ended_at: new Date(), end_reason: 'switched_off', history: [] },
      })
    }
    await writeAudit({ accountId: ctx.accountId, event: 'settings_changed', actorUserId: ctx.userId, detail: data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof StepUpError) return NextResponse.json({ error: err.message }, { status: err.status })
    return toErrorResponse(err)
  }
}
