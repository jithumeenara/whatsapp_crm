import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAccountRole } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = (await req.json()) as { name?: unknown; whatsapp?: unknown; role?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : ''
    // Default to 'agent' if no role is provided (the Add Agent dialog omits it)
    const rawRole = body.role
    const role = isAccountRole(rawRole) && rawRole !== 'owner' ? rawRole : 'agent'

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!whatsapp) return NextResponse.json({ error: 'WhatsApp number is required' }, { status: 400 })

    // Strip everything except digits — this becomes both email key and login credential
    const digits = whatsapp.replace(/\D/g, '')
    if (digits.length < 7) {
      return NextResponse.json({ error: 'Enter a valid WhatsApp number' }, { status: 400 })
    }

    const memberEmail = `${digits}@agent.local`

    const existing = await prisma.user.findUnique({
      where: { email: memberEmail },
      select: {
        id: true,
        profile: { select: { account_id: true } },
        owned_accounts: { select: { id: true } },
      },
    })
    if (existing) {
      // Orphaned agent: the user exists but belongs to a different account
      // (the old DELETE handler moved them to a personal account instead of
      // deleting them). Clean up the stale record so it can be re-created.
      const profileAccountId = existing.profile?.account_id
      if (profileAccountId !== ctx.accountId) {
        await prisma.$transaction(async (tx) => {
          // Must delete owned accounts before the user due to Restrict FK.
          // Cascade on Account deletes the profile automatically.
          for (const acct of existing.owned_accounts) {
            await tx.account.delete({ where: { id: acct.id } })
          }
          // If somehow the profile survived (no owned account), delete it.
          if (existing.profile) {
            await tx.profile.deleteMany({ where: { user_id: existing.id } })
          }
          await tx.user.delete({ where: { id: existing.id } })
        })
      } else {
        return NextResponse.json(
          { error: 'A member with this WhatsApp number already exists' },
          { status: 409 },
        )
      }
    }

    const password = randomBytes(16).toString('hex')
    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: memberEmail,
          password_hash: passwordHash,
          email_verified: new Date(),
        },
      })

      // Profile goes directly into the caller's account with the chosen role.
      // No separate personal account is created — the member belongs to this
      // CRM account from day one.
      await tx.profile.create({
        data: {
          user_id: newUser.id,
          full_name: name,
          email: memberEmail,
          account_id: ctx.accountId,
          account_role: role,
        },
      })
    })

    return NextResponse.json(
      { ok: true, member: { name, role, username: digits, whatsapp: digits, password } },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
