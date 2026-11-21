import { beforeAll, describe, expect, it } from 'vitest'
import { publicMediaUrl, signMediaToken, verifyMediaToken } from './social-media-token'

// The public link Instagram fetches media from: one file, own folder,
// 30 minutes, signed with a purpose-only key; anything else is refused.

const ACC = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-2222-4333-8444-555555555555'
const LINK = `/api/files/account-${ACC}/2026/11/abc.jpg`

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-media' })

describe('signed media link', () => {
  it('round-trips for its own file within 30 minutes, then expires', () => {
    const now = Date.now()
    const t = signMediaToken(ACC, LINK, now)
    expect(verifyMediaToken(t, now + 60_000)).toEqual({ accountId: ACC, link: LINK })
    expect(verifyMediaToken(t, now + 31 * 60_000)).toBeNull()
  })
  it("will not sign another workspace's file, a path outside uploads, or a traversal", () => {
    expect(() => signMediaToken(ACC, `/api/files/account-${OTHER}/x.jpg`)).toThrow()
    expect(() => signMediaToken(ACC, '/etc/passwd')).toThrow()
    expect(() => signMediaToken(ACC, `https://evil.example/x.jpg`)).toThrow()
  })
  it('a changed payload or signature is refused', () => {
    const t = signMediaToken(ACC, LINK)
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ a: OTHER, l: `/api/files/account-${OTHER}/x.jpg`, e: Date.now() + 60_000 })).toString('base64url')
    expect(verifyMediaToken(`${forged}.${sig}`)).toBeNull()
    expect(verifyMediaToken(`${body}.${sig.slice(0, -2)}xx`)).toBeNull()
    expect(verifyMediaToken(`${body}.${sig}.extra`)).toBeNull()
    expect(verifyMediaToken(42)).toBeNull()
  })
  it('no https address configured: no public link at all', () => {
    const saved = { a: process.env.NEXT_PUBLIC_APP_URL, b: process.env.NEXTAUTH_URL }
    process.env.NEXT_PUBLIC_APP_URL = 'http://crm.example'
    process.env.NEXTAUTH_URL = ''
    expect(publicMediaUrl(ACC, LINK)).toBeNull()
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example'
    expect(publicMediaUrl(ACC, LINK)?.startsWith('https://crm.example/api/social/media/')).toBe(true)
    process.env.NEXT_PUBLIC_APP_URL = saved.a
    process.env.NEXTAUTH_URL = saved.b
  })
})
