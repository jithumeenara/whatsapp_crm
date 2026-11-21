import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The PUBLIC media route Meta fetches from: only a valid, unexpired token
 * for a file in that workspace's own folder, only a real JPEG/PNG/MP4/MOV
 * (checked from the bytes), and the same plain 404 for every refusal.
 */

const ACC = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), size: 6, isFile: true }))

vi.mock('fs/promises', () => ({
  stat: async () => ({ isFile: () => h.isFile, size: h.size }),
  readFile: async () => h.bytes,
}))
vi.mock('@/lib/whatsapp/media-ref', () => ({
  uploadPathFor: (link: string, accountId: string) => {
    if (!link.startsWith(`/api/files/account-${accountId}/`)) throw new Error('not yours')
    return '/uploads/x'
  },
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }) }))

import { GET } from './route'
import { signMediaToken } from '@/lib/meta/social-media-token'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-media-route' })
beforeEach(() => { h.bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]); h.size = 6; h.isFile = true })

const get = (token: string) => GET(new Request('http://x'), { params: Promise.resolve({ token }) })

describe('public media for Meta', () => {
  it('a valid link serves the picture with safe headers', async () => {
    const res = await get(signMediaToken(ACC, `/api/files/account-${ACC}/2026/a.jpg`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it('a forged or expired token: 404', async () => {
    expect((await get('abc.def')).status).toBe(404)
    const old = signMediaToken(ACC, `/api/files/account-${ACC}/a.jpg`, Date.now() - 31 * 60_000)
    expect((await get(old)).status).toBe(404)
  })
  it('a file that is not really a picture (HTML named .jpg): 404', async () => {
    h.bytes = Buffer.from('<html><script>alert(1)</script>')
    expect((await get(signMediaToken(ACC, `/api/files/account-${ACC}/a.jpg`))).status).toBe(404)
  })
  it('a type Meta does not publish (.pdf, .svg): 404', async () => {
    expect((await get(signMediaToken(ACC, `/api/files/account-${ACC}/a.pdf`))).status).toBe(404)
    expect((await get(signMediaToken(ACC, `/api/files/account-${ACC}/a.svg`))).status).toBe(404)
  })
  it('too big or not a file: 404', async () => {
    h.size = 101 * 1024 * 1024
    expect((await get(signMediaToken(ACC, `/api/files/account-${ACC}/a.jpg`))).status).toBe(404)
    h.size = 6; h.isFile = false
    expect((await get(signMediaToken(ACC, `/api/files/account-${ACC}/a.jpg`))).status).toBe(404)
  })
})
