import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

const microsoftMailbox = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() }))
const processInbound = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { microsoftMailbox, $executeRawUnsafe: vi.fn().mockResolvedValue(0) } }))
vi.mock('@/lib/email/ingest', () => ({ processInbound }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, '') }))

import { authorizeUrl, isGuid, newPkce } from './graph'
import { publicOrigin } from './origin'
import { POST as notify } from '@/app/api/email/microsoft/notify/route'

const T = '6177e5b2-f174-4a2b-9c3d-1234567890ab'
const C = 'c3265859-421f-4d59-bc5c-abcdefabcdef'

describe('sign-in URL', () => {
  it('only accepts GUIDs for tenant and client', () => {
    expect(isGuid(T)).toBe(true)
    expect(isGuid('evil.com/x')).toBe(false)
    expect(() => authorizeUrl({ tenantId: 'evil.com', clientId: C, redirectUri: 'https://x', state: 's', challenge: 'c' })).toThrow()
  })

  it('goes to Microsoft with PKCE, state and the four scopes', () => {
    const url = new URL(authorizeUrl({ tenantId: T, clientId: C, redirectUri: 'https://www.x.online/api/email/microsoft/callback', state: 'st', challenge: 'ch' }))
    expect(url.origin).toBe('https://login.microsoftonline.com')
    expect(url.pathname).toBe(`/${T}/oauth2/v2.0/authorize`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('scope')).toBe('offline_access User.Read Mail.ReadWrite Mail.Send')
  })

  it('makes a PKCE challenge that is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = newPkce()
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('publicOrigin', () => {
  it('uses the forwarded host, and refuses anything that is not a plain host', () => {
    const ok = new Request('http://127.0.0.1/x', { headers: { 'x-forwarded-host': 'www.acstikereala.online', 'x-forwarded-proto': 'https' } })
    expect(publicOrigin(ok)).toBe('https://www.acstikereala.online')
    const bad = new Request('http://127.0.0.1/x', { headers: { 'x-forwarded-host': 'evil.com/@x', host: '' } })
    expect(publicOrigin(bad)).not.toContain('evil.com/@')
  })
})

describe('notification endpoint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers Graph’s validation with the token as plain text', async () => {
    const res = await notify(new NextRequest('https://x/api/email/microsoft/notify?validationToken=abc%20123', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('abc 123')
  })

  it('ignores a notification whose clientState does not match', async () => {
    microsoftMailbox.findFirst.mockResolvedValue({ id: 'b', client_state: 'the-real-secret', account_id: 'acc' })
    const body = JSON.stringify({ value: [{ subscriptionId: 'sub', clientState: 'forged', resourceData: { id: 'm1' } }] })
    const res = await notify(new NextRequest('https://x/api/email/microsoft/notify', { method: 'POST', body }))
    expect(res.status).toBe(202)
    await new Promise((r) => setTimeout(r, 20))
    expect(processInbound).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const res = await notify(new NextRequest('https://x/api/email/microsoft/notify', { method: 'POST', body: 'nope' }))
    expect(res.status).toBe(400)
  })
})
