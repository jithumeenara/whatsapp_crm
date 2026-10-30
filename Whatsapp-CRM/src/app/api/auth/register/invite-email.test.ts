import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from '@/lib/auth/invite-fake-db.test-helper'

/**
 * Round 2: an invitation can name who it is for. Then only a sign-up
 * with that address (ignoring case and stray spaces) may use it — a
 * forwarded or leaked link is no use to anybody else. Links made without
 * an address work as before, once, and the server log says so.
 */

const h = vi.hoisted(() => ({ fake: null as ReturnType<typeof makeFakeDb> | null }))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return h.fake!.db
  },
}))
vi.mock('@/lib/whatsapp/phone-utils', () => ({ isValidE164: () => true }))

import { POST } from './route'

const TOKEN = 'E'.repeat(43)
const register = (email: string) =>
  POST(
    new Request('http://x/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'correct horse', invite: TOKEN }),
    }) as never,
  )

describe('an invitation for a named address', () => {
  beforeEach(() => {
    h.fake = makeFakeDb()
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is refused to a different address and stays unused', async () => {
    h.fake!.addInvitation(TOKEN, { email: 'anu@example.com' })
    const res = await register('mallory@example.com')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/different email/i)
    expect(h.fake!.state.users).toHaveLength(0)
    expect(h.fake!.state.invitations[0].accepted_at).toBeNull()
  })

  it('accepts the named address whatever its case and spacing', async () => {
    h.fake!.addInvitation(TOKEN, { email: 'anu@example.com' })
    expect((await register('  Anu@Example.COM ')).status).toBe(201)
    expect(h.fake!.state.profiles[0].account_id).toBe('team-acc')
  })

  it('a link with no address still works once, and is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.fake!.addInvitation(TOKEN, { email: null })
    expect((await register('anyone@example.com')).status).toBe(201)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no email'), expect.anything())
  })
})
