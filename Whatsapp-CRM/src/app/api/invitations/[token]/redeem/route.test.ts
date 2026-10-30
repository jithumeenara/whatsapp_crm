import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from '@/lib/auth/invite-fake-db.test-helper'

/**
 * Redeeming checked the invitation, then marked it used in a separate
 * step. Two people who opened the same link at the same moment both
 * passed the check and both joined — a single-use invitation let two in.
 * It is now claimed with one conditional update, inside the move.
 */

const h = vi.hoisted(() => ({
  fake: null as ReturnType<typeof makeFakeDb> | null,
  callers: [] as string[],
  forgotten: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return h.fake!.db
  },
}))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: h.callers.shift() } }) }))
vi.mock('@/lib/auth/account', () => ({ forgetCachedProfile: (id: string) => h.forgotten.push(id) }))

import { POST } from './route'

const TOKEN = 'R'.repeat(43)
let ip = 0
const redeem = (userId: string) => {
  h.callers.push(userId)
  return POST(new Request('http://x/redeem', { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${++ip}` } }), {
    params: Promise.resolve({ token: TOKEN }),
  })
}

function personalAccount(userId: string) {
  const acc = `own-${userId}`
  h.fake!.state.accounts.push({ id: acc, name: userId, owner_user_id: userId })
  h.fake!.state.profiles.push({ user_id: userId, account_id: acc, account_role: 'owner' })
}

describe('redeeming an invitation', () => {
  beforeEach(() => {
    h.fake = makeFakeDb()
    h.callers = []
    h.forgotten = []
  })

  it('lets exactly one person in when two redeem the same link at once', async () => {
    h.fake!.addInvitation(TOKEN, { role: 'agent' })
    personalAccount('alice')
    personalAccount('bob')
    const [a, b] = await Promise.all([redeem('alice'), redeem('bob')])
    expect([a.status, b.status].sort()).toEqual([200, 400])
    const inTeam = h.fake!.state.profiles.filter((p) => p.account_id === 'team-acc')
    expect(inTeam).toHaveLength(1)
    expect(inTeam[0].account_role).toBe('agent')
    expect(h.fake!.state.invitations[0].accepted_by_user_id).toBe(inTeam[0].user_id)
  })

  it('moves the caller at the invitation role and drops their cached role at once', async () => {
    h.fake!.addInvitation(TOKEN, { role: 'viewer' })
    personalAccount('alice')
    expect((await redeem('alice')).status).toBe(200)
    expect(h.fake!.state.profiles[0]).toEqual(expect.objectContaining({ account_id: 'team-acc', account_role: 'viewer' }))
    expect(h.forgotten).toContain('alice')
  })

  it('refuses an expired or used invitation and changes nothing', async () => {
    h.fake!.addInvitation(TOKEN, { expires_at: new Date(Date.now() - 1) })
    personalAccount('alice')
    expect((await redeem('alice')).status).toBe(400)
    expect(h.fake!.state.profiles[0].account_id).toBe('own-alice')
  })

  it('will not let the owner of a team walk away from it and leave it ownerless', async () => {
    h.fake!.addInvitation(TOKEN)
    personalAccount('alice')
    h.fake!.state.profiles.push({ user_id: 'teammate', account_id: 'own-alice', account_role: 'agent' })
    expect((await redeem('alice')).status).toBe(409)
    expect(h.fake!.state.invitations[0].accepted_at).toBeNull()
    expect(h.fake!.state.profiles[0].account_id).toBe('own-alice')
  })

  it('an invitation for a named address is refused to a login with another one (round 2)', async () => {
    h.fake!.addInvitation(TOKEN, { email: 'anu@example.com' })
    personalAccount('alice')
    h.fake!.state.users.push({ id: 'alice', email: 'alice@example.com', password_hash: 'x' })
    const res = await redeem('alice')
    expect(res.status).toBe(403)
    expect(h.fake!.state.invitations[0].accepted_at).toBeNull()
    expect(h.fake!.state.profiles[0].account_id).toBe('own-alice')
  })

  it('and accepted for the named address, ignoring case (round 2)', async () => {
    h.fake!.addInvitation(TOKEN, { email: 'anu@example.com' })
    personalAccount('anu')
    h.fake!.state.users.push({ id: 'anu', email: 'Anu@Example.com', password_hash: 'x' })
    expect((await redeem('anu')).status).toBe(200)
  })
})
