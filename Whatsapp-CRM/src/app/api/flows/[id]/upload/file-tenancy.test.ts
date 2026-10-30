import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A Flow's Image components point at `/api/files/...`; building the Flow
 * JSON (GET ?preview=1 returns it, POST uploads it to Meta) reads each
 * file from disk and inlines it as base64. The path was only joined to
 * uploads/, never checked: a member could inline account B's stored file
 * (`/api/files/account-B/...`) or walk out of uploads/ with `../` and read
 * it back in the preview — A3-22.
 */

const h = vi.hoisted(() => ({ src: '', read: [] as string[] }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/flows/route-guard', () => ({ denyUnlessFlowEditor: async () => null }))
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, readFile: vi.fn(async (p: string) => { h.read.push(String(p)); return Buffer.from('SECRET-BYTES') }) }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'acc-a' }) },
    flow: {
      findFirst: async () => ({
        id: 'f1',
        name: 'F',
        trigger_config: {
          screens: [{ id: 'S1', title: 'One', components: [{ type: 'Image', src: h.src }, { type: 'Footer', label: 'Done', action: 'complete' }] }],
        },
      }),
    },
  },
}))

import { GET } from './route'

const preview = () => GET(new Request('http://x/api/flows/f1/upload?preview=1'), { params: Promise.resolve({ id: 'f1' }) })
const secretB64 = Buffer.from('SECRET-BYTES').toString('base64')

describe('Flow JSON image inlining', () => {
  beforeEach(() => { h.read = [] })

  it('does not read or inline another account’s file', async () => {
    h.src = '/api/files/account-acc-b/secret.png'
    const res = await preview()
    expect(h.read).toEqual([])
    expect(await res.text()).not.toContain(secretB64)
  })

  it('does not walk out of uploads/ with ../', async () => {
    h.src = '/api/files/../.env'
    const res = await preview()
    expect(h.read).toEqual([])
    expect(await res.text()).not.toContain(secretB64)
  })

  it('still inlines this account’s own image', async () => {
    h.src = '/api/files/account-acc-a/mine.png'
    const res = await preview()
    expect(h.read).toHaveLength(1)
    expect(await res.text()).toContain(secretB64)
  })
})
