/**
 * Independent security review (A7, 2026-10) — claimInvitation, attacked
 * directly with an in-memory table that applies the same conditional
 * UPDATE semantics (a row matches only while unused, unexpired and with
 * a matching or null email), awaiting between steps so claims interleave.
 */
import { describe, expect, it } from 'vitest'
import { claimInvitation, InvitationUnavailableError } from '@/lib/auth/claim-invitation'
import { hashInviteToken } from '@/lib/auth/invitations'

type Row = { id: string; account_id: string; token_hash: string; role: string; email: string | null; accepted_at: Date | null; expires_at: Date; accepted_by_user_id?: string }
const tick = () => new Promise((r) => setTimeout(r, 0))

function tx(rows: Row[]) {
  const match = (r: Row, w: Record<string, unknown>) => {
    if (w.token_hash !== undefined && r.token_hash !== w.token_hash) return false
    if ('accepted_at' in w && w.accepted_at === null && r.accepted_at !== null) return false
    const gt = (w.expires_at as { gt?: Date } | undefined)?.gt
    if (gt && !(r.expires_at > gt)) return false
    const or = w.OR as Array<{ email: string | null }> | undefined
    if (or && !or.some((c) => (c.email === null ? r.email === null : r.email === c.email))) return false
    return true
  }
  return {
    accountInvitation: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        await tick()
        const hit = rows.filter((r) => match(r, where))
        hit.forEach((r) => Object.assign(r, data))
        return { count: hit.length }
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        await tick()
        return rows.find((r) => r.token_hash === where.token_hash) ?? null
      },
    },
  } as never
}

const TOKEN = 'tok_' + 'z'.repeat(40)
const row = (o: Partial<Row> = {}): Row => ({
  id: 'i1', account_id: 'acc', token_hash: hashInviteToken(TOKEN), role: 'agent', email: null,
  accepted_at: null, expires_at: new Date(Date.now() + 86_400_000), ...o,
})

describe('claimInvitation', () => {
  it('two simultaneous claims: exactly one wins', async () => {
    const rows = [row()]
    const t = tx(rows)
    const r = await Promise.allSettled([claimInvitation(t, TOKEN, 'u1', 'a@x.co'), claimInvitation(t, TOKEN, 'u2', 'b@x.co')])
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1)
  })
  it('cannot be reused', async () => {
    const t = tx([row()])
    await claimInvitation(t, TOKEN, 'u1', 'a@x.co')
    await expect(claimInvitation(t, TOKEN, 'u2', 'b@x.co')).rejects.toBeInstanceOf(InvitationUnavailableError)
  })
  it('an expired invitation is refused', async () => {
    await expect(claimInvitation(tx([row({ expires_at: new Date(Date.now() - 1) })]), TOKEN, 'u1', 'a@x.co')).rejects.toBeInstanceOf(InvitationUnavailableError)
  })
  it('a row saying role=owner never hands out ownership (and the claim is reported failed)', async () => {
    await expect(claimInvitation(tx([row({ role: 'owner' })]), TOKEN, 'u1', 'a@x.co')).rejects.toBeInstanceOf(InvitationUnavailableError)
  })
  it('email binding: case and surrounding whitespace match; anything else does not', async () => {
    await expect(claimInvitation(tx([row({ email: 'bob@corp.com' })]), TOKEN, 'u1', '  BOB@Corp.com ')).resolves.toMatchObject({ account_id: 'acc' })
    for (const other of ['bob@corp.co', 'b0b@corp.com', 'bоb@corp.com' /* Cyrillic о */, 'bob@corp.com.', '', 'bob@corp.com​']) {
      await expect(claimInvitation(tx([row({ email: 'bob@corp.com' })]), TOKEN, 'u1', other), JSON.stringify(other)).rejects.toMatchObject({ reason: 'wrong_email' })
    }
  })
  it('a junk or short token is refused before any query', async () => {
    for (const t of [undefined, null, 123, 'short', { $ne: null }, 'x'.repeat(201)]) {
      await expect(claimInvitation(tx([]), t, 'u1', 'a@x.co')).rejects.toBeInstanceOf(InvitationUnavailableError)
    }
  })
})
