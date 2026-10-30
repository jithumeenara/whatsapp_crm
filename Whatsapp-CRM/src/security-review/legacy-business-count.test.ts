/**
 * Independent security review (A7, round 5) — the "one business" rule for
 * unrecorded legacy files (src/lib/files/legacy-access.ts, a7a9267).
 *
 * A fake account table with real rows; the fake applies the `where` the
 * code sends, so a wrong filter shows up as a wrong count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Acc = { id: string; members: Array<{ password_hash: string | null }> }
const h = vi.hoisted(() => ({ accounts: [] as Acc[], lastWhere: null as unknown, fail: false }))
vi.mock('@/lib/db', () => ({
  prisma: {
    fileUpload: { findFirst: async () => null },
    account: {
      findMany: async ({ where, take }: { where: unknown; take: number }) => {
        if (h.fail) throw new Error('db down')
        h.lastWhere = where
        const w = where as { profiles?: { some?: { user?: { password_hash?: { not?: null } } } } } | undefined
        const needsPw = w?.profiles?.some?.user?.password_hash?.not === null
        const rows = h.accounts.filter((a) => !needsPw || a.members.some((m) => m.password_hash !== null))
        return rows.slice(0, take).map((a) => ({ id: a.id }))
      },
    },
  },
}))

import { invalidateBusinessCount, legacyFileAllowed } from '@/lib/files/legacy-access'

const MAIN: Acc = { id: 'main', members: [{ password_hash: 'x' }, { password_hash: 'y' }] }
beforeEach(() => {
  invalidateBusinessCount()
  h.fail = false
  delete process.env.NEXT_PUBLIC_ALLOW_SIGNUP
})
afterEach(() => delete process.env.NEXT_PUBLIC_ALLOW_SIGNUP)

describe('legacy files — who counts as a business', () => {
  it('main + holding (password cleared) + empty personal account → one business → allowed', async () => {
    h.accounts = [MAIN, { id: 'holding', members: [{ password_hash: null }] }, { id: 'personal', members: [] }]
    expect(await legacyFileAllowed('/api/files/old.jpg', 'main')).toBe(true)
  })
  it('a second account with ANY member who can sign in is a second business → refused', async () => {
    h.accounts = [MAIN, { id: 'b2', members: [{ password_hash: null }, { password_hash: 'z' }] }]
    expect(await legacyFileAllowed('/api/files/old.jpg', 'main')).toBe(false)
    expect(await legacyFileAllowed('/api/files/old.jpg', 'b2')).toBe(false)
  })
  it('the filter is structural (a password), not a name', () => {
    void legacyFileAllowed('/api/files/x', 'main')
    return Promise.resolve().then(() => expect(JSON.stringify(h.lastWhere ?? {})).not.toMatch(/name|removed/i))
  })
  it('open public sign-up refuses even with one business', async () => {
    h.accounts = [MAIN]
    process.env.NEXT_PUBLIC_ALLOW_SIGNUP = 'true'
    expect(await legacyFileAllowed('/api/files/old.jpg', 'main')).toBe(false)
  })
  it('an account outside the counted set (e.g. a holding account) is still refused when two businesses exist', async () => {
    h.accounts = [MAIN, { id: 'b2', members: [{ password_hash: 'z' }] }, { id: 'holding', members: [{ password_hash: null }] }]
    expect(await legacyFileAllowed('/api/files/old.jpg', 'holding')).toBe(false)
  })
  it('a DB error fails closed', async () => {
    h.fail = true
    expect(await legacyFileAllowed('/api/files/old.jpg', 'main')).toBe(false)
  })
  it('an empty accountId is refused without asking the DB', async () => {
    h.accounts = [MAIN]
    expect(await legacyFileAllowed('/api/files/old.jpg', '')).toBe(false)
  })
})
