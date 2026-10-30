/**
 * Independent security review (A7, 2026-10) — local file references used
 * by the send paths (uploadPathFor / resolveMediaRef) and the file route.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as unknown,
  fileOwner: null as null | { account_id: string },
  read: [] as string[],
  accounts: 2,
  countCalls: 0,
}))
vi.mock('@/auth', () => ({ auth: async () => h.session }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'A' }) },
    fileUpload: { findFirst: async () => h.fileOwner },
    // Round 4: the legacy rule asks how many accounts exist (take: 2).
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
  return {
    ...actual,
    default: actual,
    readFile: async (p: string) => {
      h.read.push(String(p))
      return Buffer.from('x')
    },
  }
})

import { uploadPathFor, resolveUploadPath, MediaPathError } from '@/lib/whatsapp/media-ref'
import { forgetAccountCount, invalidateBusinessCount } from '@/lib/files/legacy-access'
import { GET } from '@/app/api/files/[...path]/route'

const UP = resolve(process.cwd(), 'uploads')

describe('uploadPathFor — traversal and tenancy', () => {
  const refused = [
    '/api/files/account-B/x.jpg',
    '/api/files/account-A/../account-B/x.jpg',
    '/api/files/account-A/..%2Faccount-B%2Fx.jpg',
    '/api/files/account-A/%2e%2e/account-B/x.jpg',
    '/api/files/../.env',
    '/api/files/..%2F..%2Fetc%2Fpasswd',
    '/api/files/%2Fetc%2Fpasswd',
    '/api/files/%E0%A4%A', // malformed escape
  ]
  for (const link of refused) {
    it(`refuses ${link} for account A`, () => {
      expect(() => uploadPathFor(link, 'A')).toThrow(MediaPathError)
    })
  }
  it('accepts the account’s own file', () => {
    expect(uploadPathFor('/api/files/account-A/x.jpg', 'A')).toBe(resolve(UP, 'account-A/x.jpg'))
  })
  it('a double-encoded dot segment stays a literal name inside uploads/', () => {
    const p = uploadPathFor('/api/files/account-A/%252e%252e/x', 'A')
    expect(p.startsWith(resolve(UP, 'account-A'))).toBe(true)
  })

  // Was GAP N5 (LOW), fixed in 403f950: accountId is now required.
  // Original note: accountId was optional. resolveMediaRef(link, …, accountId?)
  // turns null into undefined and uploadPathFor then skips the folder
  // check entirely. Every current caller passes it (verified by grep), but
  // the next one that forgets reads any tenant's file. Make it required.
  it('the folder check cannot be skipped by omitting accountId', () => {
    // @ts-expect-error -- accountId is required by the type (N5); the runtime refuses too.
    expect(() => uploadPathFor('/api/files/account-B/x.jpg', undefined)).toThrow(MediaPathError)
  })
})

describe('/api/files/[...path]', () => {
  const get = (segs: string[]) => GET(new Request('http://x') as never, { params: Promise.resolve({ path: segs }) })
  it('needs a session', async () => {
    h.session = null
    expect((await get(['account-A', 'x.jpg'])).status).toBe(401)
    h.session = { user: { id: 'u1' } }
  })
  for (const segs of [['account-A', '..', 'account-B', 'x'], ['..', '.env'], ['account-A', 'a\\..\\..\\b'], ['account-A', 'x\0.jpg'], ['account-A', ''], ['.']]) {
    it(`refuses ${JSON.stringify(segs)}`, async () => {
      h.read = []
      expect([403, 404]).toContain((await get(segs)).status)
      expect(h.read).toEqual([])
    })
  }
  it('another account’s folder is 404', async () => {
    expect((await get(['account-B', 'x.jpg'])).status).toBe(404)
  })
  it('a legacy root file recorded as another account’s is 404', async () => {
    h.fileOwner = { account_id: 'B' }
    expect((await get(['legacy.pdf'])).status).toBe(404)
    h.fileOwner = null
  })
  it('an HTML/SVG file is never served inline as itself', async () => {
    for (const name of ['x.html', 'x.svg', 'x.xml']) {
      const res = await get(['account-A', name])
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })
  // Was GAP N4 (A3-23). Fixed in 403f950 by the owner's rule: an
  // unrecorded legacy file is served only while the server has ONE account.
  // The account count is mocked explicitly so this passes for the policy
  // reason, not because a missing mock made the lookup fail closed.
  it('an unrecorded legacy root file is not served to an arbitrary tenant (2+ accounts)', async () => {
    forgetAccountCount()
    h.fileOwner = null
    h.accounts = 2
    expect((await get(['legacy-id-card.jpg'])).status).toBe(404)
    expect(h.countCalls).toBeGreaterThan(0)
  })
  it('…and is served on a single-account server (owner decision)', async () => {
    forgetAccountCount()
    h.fileOwner = null
    h.accounts = 1
    expect((await get(['legacy-id-card.jpg'])).status).toBe(200)
    h.accounts = 2
    forgetAccountCount()
  })
  // Was GAP R4a (LOW, round 4), fixed in round 5: register, invitation
  // redemption, deactivateMember/reviveMember and transfer-ownership call
  // invalidateBusinessCount() (each one's own test asserts it), and the
  // TTL left for other processes is 10 s.
  // Original note: the account count is cached per process for 60 s.
  // A second account created right after the cache was filled (open
  // sign-up, or the holding account deactivateMember creates) can read the
  // first business's unrecorded legacy files for up to 60 s per process.
  // Fix: invalidate the cache from register / deactivateMember (and any
  // account.create), or do not cache a value of 1.
  it('a second account created inside the cache window is refused at once', async () => {
    forgetAccountCount()
    h.fileOwner = null
    h.accounts = 1
    expect((await get(['legacy-id-card.jpg'])).status).toBe(200) // fills the cache
    h.accounts = 2 // a stranger signs up now…
    invalidateBusinessCount() // …and sign-up drops the cached count, as it now does
    expect((await get(['legacy-id-card.jpg'])).status).toBe(404)
  })
})

describe('send paths vs the file route disagree on legacy files', () => {
  // Was GAP N4 (MEDIUM), fixed in 403f950. Original note: the file route refuses a root-level legacy file recorded
  // as another account's (FileUpload check), but uploadPathFor — used by
  // whatsapp/send, broadcasts, templates, flows, telegram — has no DB
  // check and accepts any root-level file. Tenant A can therefore send
  // tenant B's legacy upload to their own WhatsApp number and read it.
  it('uploadPathFor refuses a root-level legacy file for a sending account', () => {
    expect(() => uploadPathFor('/api/files/legacy-of-B.pdf', 'A')).toThrow(MediaPathError)
  })
  it('resolveUploadPath applies the same rule as the file route', async () => {
    forgetAccountCount()
    h.fileOwner = { account_id: 'B' }
    h.accounts = 1
    await expect(resolveUploadPath('/api/files/legacy-of-B.pdf', 'A')).rejects.toThrow(MediaPathError)
    h.fileOwner = null
    h.accounts = 2
    forgetAccountCount()
    await expect(resolveUploadPath('/api/files/legacy-unrecorded.pdf', 'A')).rejects.toThrow(MediaPathError)
    h.accounts = 1
    forgetAccountCount()
    await expect(resolveUploadPath('/api/files/legacy-unrecorded.pdf', 'A')).resolves.toMatch(/legacy-unrecorded\.pdf$/)
    h.accounts = 2
    forgetAccountCount()
  })
  it('resolveUploadPath never reaches the DB rule for another account folder or a traversal', async () => {
    for (const l of ['/api/files/account-B/x', '/api/files/account-A/../account-B/x', '/api/files/../.env']) {
      await expect(resolveUploadPath(l, 'A'), l).rejects.toThrow(MediaPathError)
    }
    await expect(resolveUploadPath('/api/files/legacy.pdf', '')).rejects.toThrow(MediaPathError)
  })
})
