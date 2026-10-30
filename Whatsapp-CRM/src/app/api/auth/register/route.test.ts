import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from '@/lib/auth/invite-fake-db.test-helper'

/**
 * Sign-up with an invitation used to check only that the invitation was
 * live, and then create a brand-new workspace with the registrant as its
 * OWNER. The invitation was never used up, so one shared link let any
 * number of strangers make themselves owners on a server whose sign-ups
 * are closed — and none of them ever joined the team that invited them.
 *
 * Now the invitation is claimed atomically in the same transaction that
 * creates the login, and the person lands in the inviting account with
 * the invitation's role. Nothing in the request body can change either.
 */

const h = vi.hoisted(() => ({ fake: null as ReturnType<typeof makeFakeDb> | null }))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return h.fake!.db
  },
}))
vi.mock('@/lib/whatsapp/phone-utils', () => ({ isValidE164: () => true }))

import { POST } from './route'

const TOKEN = 'T'.repeat(43)
const register = (body: Record<string, unknown>) =>
  POST(
    new Request('http://x/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse', full_name: 'New Person', ...body }),
    }) as never,
  )

describe('sign-up with an invitation', () => {
  beforeEach(() => {
    h.fake = makeFakeDb()
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('joins the inviting account with the invitation role — no new workspace, never owner', async () => {
    h.fake!.addInvitation(TOKEN, { role: 'agent', account_id: 'team-acc' })
    const res = await register({ email: 'Anu@Example.com ', invite: TOKEN, role: 'owner', account_role: 'owner' })
    expect(res.status).toBe(201)
    expect(h.fake!.state.accounts).toHaveLength(0)
    expect(h.fake!.state.profiles).toEqual([
      expect.objectContaining({ account_id: 'team-acc', account_role: 'agent', email: 'anu@example.com' }),
    ])
    const inv = h.fake!.state.invitations[0]
    expect(inv.accepted_at).toBeInstanceOf(Date)
    expect(inv.accepted_by_user_id).toBe(h.fake!.state.users[0].id)
  })

  it('an invitation makes exactly one login, even when two sign-ups race for it', async () => {
    h.fake!.addInvitation(TOKEN)
    const [a, b] = await Promise.all([
      register({ email: 'a@example.com', invite: TOKEN }),
      register({ email: 'b@example.com', invite: TOKEN }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 403])
    expect(h.fake!.state.users).toHaveLength(1)
    expect(h.fake!.state.profiles).toHaveLength(1)
    expect(h.fake!.state.accounts).toHaveLength(0)
  })

  it('a used invitation lets nobody else in', async () => {
    h.fake!.addInvitation(TOKEN)
    expect((await register({ email: 'a@example.com', invite: TOKEN })).status).toBe(201)
    expect((await register({ email: 'c@example.com', invite: TOKEN })).status).toBe(403)
    expect(h.fake!.state.users).toHaveLength(1)
  })

  it('an expired invitation is refused', async () => {
    h.fake!.addInvitation(TOKEN, { expires_at: new Date(Date.now() - 1000) })
    expect((await register({ email: 'a@example.com', invite: TOKEN })).status).toBe(403)
    expect(h.fake!.state.users).toHaveLength(0)
  })

  it('a failed sign-up leaves the invitation unused', async () => {
    h.fake!.addInvitation(TOKEN)
    h.fake!.state.users.push({ id: 'existing', email: 'taken@example.com', password_hash: 'x' })
    expect((await register({ email: 'taken@example.com', invite: TOKEN })).status).toBe(409)
    expect(h.fake!.state.invitations[0].accepted_at).toBeNull()
  })
})

describe('sign-up without an invitation', () => {
  beforeEach(() => {
    h.fake = makeFakeDb()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is refused while sign-ups are closed — nobody becomes an owner', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', '')
    expect((await register({ email: 'x@example.com' })).status).toBe(403)
    expect(h.fake!.state.accounts).toHaveLength(0)
  })

  it('when the server opens sign-ups, makes the person the owner of their own new workspace', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', 'true')
    expect((await register({ email: 'x@example.com' })).status).toBe(201)
    expect(h.fake!.state.accounts).toHaveLength(1)
    expect(h.fake!.state.profiles[0]).toEqual(expect.objectContaining({ account_role: 'owner' }))
  })

  it('cannot take an agent phone-login address', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', 'true')
    expect((await register({ email: '919876543210@agent.local' })).status).toBe(400)
    expect(h.fake!.state.users).toHaveLength(0)
  })

  it('needs at least 8 characters of password, like every other password in the app', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', 'true')
    expect((await register({ email: 'x@example.com', password: 'short7!' })).status).toBe(400)
  })
})
