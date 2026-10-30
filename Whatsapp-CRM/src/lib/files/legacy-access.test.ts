/**
 * N4 (security review 2026-10, A3-23): files uploaded before per-account
 * folders. Decision: a recorded file belongs to its account; an unrecorded
 * one is usable only while the server has a single account. The file route
 * and every send path follow the same rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const h = vi.hoisted(() => ({
  accounts: 1,
  owner: null as null | { account_id: string },
  countCalls: 0,
  // Round 5 (R4b): when set, the server's real shape — each account with
  // its members, `active` meaning the member can still sign in. The mock
  // applies the query's own filter, so a count of bare Account rows (the
  // round-4 rule) sees holding and empty accounts and fails these tests.
  rows: null as null | Array<{ id: string; members: Array<{ active: boolean }> }>,
}))

type FindManyArgs = {
  take: number
  where?: { profiles?: { some?: { user?: { password_hash?: { not?: null } } } } }
}

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'A' }) },
    fileUpload: { findFirst: async () => h.owner },
    account: {
      findMany: async ({ take, where }: FindManyArgs) => {
        h.countCalls++
        if (h.rows) {
          const activeOnly = where?.profiles?.some?.user?.password_hash?.not === null
          return h.rows
            .filter((r) => !activeOnly || r.members.some((m) => m.active))
            .slice(0, take)
            .map((r) => ({ id: r.id }))
        }
        return Array.from({ length: Math.min(h.accounts, take) }, (_, i) => ({ id: `acc${i}` }))
      },
    },
  },
}))
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  const readFile = async () => Buffer.from('x')
  return { ...actual, default: { ...actual, readFile }, readFile }
})

import { forgetAccountCount, invalidateBusinessCount, legacyFileAllowed } from './legacy-access'
import { GET } from '@/app/api/files/[...path]/route'
import { MediaPathError, resolveUploadPath, uploadPathFor } from '@/lib/whatsapp/media-ref'

const UP = resolve(process.cwd(), 'uploads')
const get = (segs: string[]) => GET(new Request('http://x') as never, { params: Promise.resolve({ path: segs }) })

beforeEach(() => {
  forgetAccountCount()
  h.accounts = 1
  h.owner = null
  h.countCalls = 0
  h.rows = null
  vi.unstubAllEnvs()
  vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', '')
})

describe('file route — unrecorded legacy root file', () => {
  it('single-account server: served (200)', async () => {
    h.accounts = 1
    expect((await get(['old-photo.jpg'])).status).toBe(200)
  })
  it('two accounts: 404', async () => {
    h.accounts = 2
    expect((await get(['old-photo.jpg'])).status).toBe(404)
  })
  it('a recorded file keeps the ownership check whatever the account count', async () => {
    h.accounts = 1
    h.owner = { account_id: 'B' }
    expect((await get(['old-photo.jpg'])).status).toBe(404)
    h.owner = { account_id: 'A' }
    h.accounts = 2
    expect((await get(['old-photo.jpg'])).status).toBe(200)
  })
})

describe('send paths — legacy root file', () => {
  it('uploadPathFor alone never accepts one (it cannot ask the database)', () => {
    expect(() => uploadPathFor('/api/files/old.pdf', 'A')).toThrow(MediaPathError)
  })
  it('single-account server, unrecorded: sendable', async () => {
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).resolves.toBe(resolve(UP, 'old.pdf'))
  })
  it('two accounts, unrecorded: refused', async () => {
    h.accounts = 2
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).rejects.toThrow(MediaPathError)
  })
  it('recorded as another account: refused even on a single-account server', async () => {
    h.owner = { account_id: 'B' }
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).rejects.toThrow(MediaPathError)
  })
  it('recorded as the caller’s account: sendable with many accounts', async () => {
    h.accounts = 5
    h.owner = { account_id: 'A' }
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).resolves.toBe(resolve(UP, 'old.pdf'))
  })
  it('own account folder needs no database check; another folder is refused', async () => {
    await expect(resolveUploadPath('/api/files/account-A/x.jpg', 'A')).resolves.toBe(resolve(UP, 'account-A/x.jpg'))
    await expect(resolveUploadPath('/api/files/account-B/x.jpg', 'A')).rejects.toThrow(MediaPathError)
  })
  it('an empty account id is refused', async () => {
    await expect(resolveUploadPath('/api/files/account-A/x.jpg', '')).rejects.toThrow(MediaPathError)
  })
})

describe('account count cache', () => {
  it('is reused within 60 s, then re-read', async () => {
    vi.useFakeTimers()
    try {
      await legacyFileAllowed('/api/files/a', 'A')
      await legacyFileAllowed('/api/files/a', 'A')
      expect(h.countCalls).toBe(1)
      h.accounts = 2
      vi.advanceTimersByTime(61_000)
      expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(false)
      expect(h.countCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
  it('a database error fails closed', async () => {
    h.owner = null
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { prisma } = await import('@/lib/db')
    const orig = prisma.fileUpload.findFirst
    ;(prisma.fileUpload as { findFirst: unknown }).findFirst = async () => {
      throw new Error('db down')
    }
    try {
      expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(false)
    } finally {
      ;(prisma.fileUpload as { findFirst: unknown }).findFirst = orig
      spy.mockRestore()
    }
  })
})

describe('R4b — "one business", not "one Account row"', () => {
  const main = { id: 'main', members: [{ active: true }, { active: true }] }
  it('a holding account from a removed member does not count: served', async () => {
    h.rows = [main, { id: 'holding', members: [{ active: false }] }]
    expect((await get(['old-photo.jpg'])).status).toBe(200)
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).resolves.toBe(resolve(UP, 'old.pdf'))
  })
  it('an empty personal account left by an early sign-up does not count: served', async () => {
    h.rows = [main, { id: 'personal', members: [] }]
    expect((await get(['old-photo.jpg'])).status).toBe(200)
  })
  it('two real businesses: 404 and not sendable', async () => {
    h.rows = [main, { id: 'other', members: [{ active: true }] }]
    expect((await get(['old-photo.jpg'])).status).toBe(404)
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).rejects.toThrow(MediaPathError)
  })
  it('public sign-up open: refused even with one business (a stranger could make the second)', async () => {
    h.rows = [main]
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SIGNUP', 'true')
    expect((await get(['old-photo.jpg'])).status).toBe(404)
    await expect(resolveUploadPath('/api/files/old.pdf', 'A')).rejects.toThrow(MediaPathError)
  })
  it('the count query failing fails closed', async () => {
    h.rows = [main]
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { prisma } = await import('@/lib/db')
    const orig = prisma.account.findMany
    ;(prisma.account as { findMany: unknown }).findMany = async () => {
      throw new Error('db down')
    }
    try {
      expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(false)
    } finally {
      ;(prisma.account as { findMany: unknown }).findMany = orig
      spy.mockRestore()
    }
  })
})

describe('R4a — the business count goes stale for at most 10 s, and not at all in this process', () => {
  it('invalidateBusinessCount() makes the next check re-read', async () => {
    h.accounts = 1
    expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(true)
    h.accounts = 2
    invalidateBusinessCount()
    expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(false)
  })
  it('another process’s change is seen within 10 s', async () => {
    vi.useFakeTimers()
    try {
      expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(true)
      h.accounts = 2
      vi.advanceTimersByTime(10_001)
      expect(await legacyFileAllowed('/api/files/a', 'A')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
