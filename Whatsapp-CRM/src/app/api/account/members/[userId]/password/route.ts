import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { agentUsername, canIssueAgentPassword } from '@/lib/auth/agent-credentials'
import { canActOnMember, isAccountRole } from '@/lib/auth/roles'
import { invalidateAllSessions } from '@/lib/auth/session-invalidation'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/account/members/[userId]/password
 *
 * A new password for a phone-number login (Add Agent). The admin sees it
 * once, to send to the agent; every session the agent had is signed out.
 * The way back in for an agent who lost theirs — and for agents created
 * while the Add Agent dialog showed the number instead of the password.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:memberPassword:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { userId } = await params
    const target = await prisma.profile.findFirst({
      where: { user_id: userId, account_id: ctx.accountId },
      select: { user_id: true, full_name: true, account_role: true, user: { select: { email: true } } },
    })
    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const email = target.user?.email ?? null
    // Only the owner acts on admins; nobody resets the owner's password.
    // (canIssueAgentPassword below already limits targets to roles below
    // admin — this states the policy where the other member routes do.)
    if (!isAccountRole(target.account_role) || !canActOnMember(ctx.role, target.account_role)) {
      return NextResponse.json({ error: 'Only the account owner can act on an admin.' }, { status: 403 })
    }
    if (
      !canIssueAgentPassword({ email, role: target.account_role, sameAccount: true, isSelf: target.user_id === ctx.userId })
    ) {
      return NextResponse.json(
        { error: 'A new password can only be made for an agent who signs in with their WhatsApp number.' },
        { status: 400 },
      )
    }

    const password = randomBytes(16).toString('hex')
    await prisma.user.update({ where: { id: target.user_id }, data: { password_hash: await bcrypt.hash(password, 12) } })
    await invalidateAllSessions(target.user_id)

    const username = agentUsername(email)!
    return NextResponse.json({
      member: { name: target.full_name ?? '', username, whatsapp: username, password },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
