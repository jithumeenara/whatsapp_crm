import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { UNSAFE_NAME_CHARS } from '@/lib/auth/person-name'

/**
 * PUT /api/account/members/[userId]/team   { team: string | null }
 *
 * Puts a member in a team, or takes them out (an empty name), for the
 * Spending report's "by team". Admins only. The member is looked up inside
 * the admin's own business: an id from the address is never enough. A person
 * is in at most one team.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Any control character (NUL, newline, tab...) or direction override has no
// place in a name: the override can reorder the report around it.
const CONTROL = UNSAFE_NAME_CHARS

export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { userId } = await params
    if (!UUID.test(userId)) return NextResponse.json({ error: 'That is not a member.' }, { status: 400 })

    const body = (await req.json().catch(() => null)) as { team?: unknown } | null
    const raw = body?.team
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
      return NextResponse.json({ error: 'The team name must be text.' }, { status: 400 })
    }
    const team = typeof raw === 'string' ? raw.trim() : ''
    if (team.length > 60 || CONTROL.test(team)) {
      return NextResponse.json({ error: 'The team name can be up to 60 characters, with no line breaks.' }, { status: 400 })
    }

    const member = await prisma.profile.findFirst({
      where: { account_id: ctx.accountId, user_id: userId },
      select: { user_id: true },
    })
    if (!member) return NextResponse.json({ error: 'That member was not found in your business.' }, { status: 404 })

    if (team) {
      await prisma.memberTeam.upsert({
        where: { account_id_user_id: { account_id: ctx.accountId, user_id: userId } },
        update: { team, updated_at: new Date() },
        create: { account_id: ctx.accountId, user_id: userId, team },
      })
    } else {
      await prisma.memberTeam.deleteMany({ where: { account_id: ctx.accountId, user_id: userId } })
    }

    // That a team changed and for whom, never the name itself.
    await auditConfigChange(auditCtx(req, ctx), 'config.other_changed', {
      area: 'member_team',
      fields: ['team'],
      target: { type: 'member', id: userId },
    })
    return NextResponse.json({ ok: true, team: team || null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
