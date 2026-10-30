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
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'A' }) },
    fileUpload: { findFirst: async () => h.owner },
    account: {
      findMany: async ({ take }: { take: number }) => {
        h.countCalls++
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

import { forgetAccountCount, legacyFileAllowed } from './legacy-access'
import { GET } from '@/app/api/files/[...path]/route'
import { MediaPathError, resolveUploadPath, uploadPathFor } from '@/lib/whatsapp/media-ref'

const UP = resolve(process.cwd(), 'uploads')
const get = (segs: string[]) => GET(new Request('http://x') as never, { params: Promise.resolve({ path: segs }) })

beforeEach(() => {
  forgetAccountCount()
  h.accounts = 1
  h.owner = null
  h.countCalls = 0
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
