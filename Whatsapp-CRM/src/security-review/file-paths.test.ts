/**
 * Independent security review (A7, 2026-10) — local file references used
 * by the send paths (uploadPathFor / resolveMediaRef) and the file route.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const h = vi.hoisted(() => ({ session: { user: { id: 'u1' } } as unknown, fileOwner: null as null | { account_id: string }, read: [] as string[] }))
vi.mock('@/auth', () => ({ auth: async () => h.session }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'A' }) },
    fileUpload: { findFirst: async () => h.fileOwner },
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

import { uploadPathFor, MediaPathError } from '@/lib/whatsapp/media-ref'
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

  // GAP (LOW): accountId is optional. resolveMediaRef(link, …, accountId?)
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
  // GAP (MEDIUM, A3-23 left open): a root-level legacy file with NO
  // FileUpload row is served to any signed-in user of ANY tenant.
  it('an unrecorded legacy root file is not served to an arbitrary tenant', async () => {
    h.fileOwner = null
    expect((await get(['legacy-id-card.jpg'])).status).toBe(404)
  })
})

describe('send paths vs the file route disagree on legacy files', () => {
  // GAP (MEDIUM): the file route refuses a root-level legacy file recorded
  // as another account's (FileUpload check), but uploadPathFor — used by
  // whatsapp/send, broadcasts, templates, flows, telegram — has no DB
  // check and accepts any root-level file. Tenant A can therefore send
  // tenant B's legacy upload to their own WhatsApp number and read it.
  it('uploadPathFor refuses a root-level legacy file for a sending account', () => {
    expect(() => uploadPathFor('/api/files/legacy-of-B.pdf', 'A')).toThrow(MediaPathError)
  })
})
