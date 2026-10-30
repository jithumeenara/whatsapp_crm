import { beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { encode } from 'next-auth/jwt'
import { proxy } from './proxy'
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session-timing'

/**
 * The proxy is the only place the idle timeout is enforced, so these
 * tests are about the ways a request could get past it without being
 * looked at.
 */

const SECRET = 'proxy-test-secret'
const COOKIE = 'authjs.session-token' // NODE_ENV is "test" here

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET
})

async function sessionCookie(claims: Record<string, unknown>): Promise<string> {
  const token = await encode({ token: { id: 'user-1', ...claims }, secret: SECRET, salt: COOKIE, maxAge: 8 * 3600 })
  return `${COOKIE}=${token}`
}
const idle = () => sessionCookie({ lastActivity: Date.now() - IDLE_TIMEOUT_MS - 60_000 })
const fresh = () => sessionCookie({ lastActivity: Date.now() })

function request(path: string, init: { method?: string; cookie?: string; authorization?: string } = {}) {
  const headers = new Headers()
  if (init.cookie) headers.set('cookie', init.cookie)
  if (init.authorization) headers.set('authorization', init.authorization)
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers })
}

/** NextResponse.next() — the request goes on to the route. */
const passed = (res: Response) => res.headers.get('x-middleware-next') === '1'

describe('idle timeout cannot be skipped with a made-up API key header', () => {
  it('refuses an idle session that adds "Authorization: Bearer wcrm_…"', async () => {
    const res = await proxy(request('/api/contacts', { cookie: await idle(), authorization: 'Bearer wcrm_anything' }))
    expect(passed(res)).toBe(false)
    expect(res.status).toBe(401)
  })

  it('refuses the heartbeat that would revive it', async () => {
    const res = await proxy(
      request('/api/heartbeat', { method: 'POST', cookie: await idle(), authorization: 'Bearer wcrm_x' }),
    )
    expect(passed(res)).toBe(false)
  })

  it('still lets a real API-key call through (no session at all)', async () => {
    const res = await proxy(request('/api/contacts', { authorization: 'Bearer wcrm_realkey' }))
    expect(passed(res)).toBe(true)
  })

  it('still lets an active session with the header through', async () => {
    const res = await proxy(request('/api/contacts', { cookie: await fresh(), authorization: 'Bearer wcrm_x' }))
    expect(passed(res)).toBe(true)
  })

  it('does not let the header open a page without signing in', async () => {
    const res = await proxy(request('/dashboard', { authorization: 'Bearer wcrm_x' }))
    expect(passed(res)).toBe(false)
    expect(res.headers.get('location')).toContain('/login')
  })
})

describe('the session update endpoint cannot revive an idle session', () => {
  it('refuses POST /api/auth/session from an idle session', async () => {
    const res = await proxy(request('/api/auth/session', { method: 'POST', cookie: await idle() }))
    expect(passed(res)).toBe(false)
    expect(res.status).toBe(401)
  })

  it('leaves the rest of /api/auth alone', async () => {
    expect(passed(await proxy(request('/api/auth/session', { cookie: await idle() })))).toBe(true)
    expect(passed(await proxy(request('/api/auth/session', { method: 'POST', cookie: await fresh() })))).toBe(true)
    expect(passed(await proxy(request('/api/auth/csrf')))).toBe(true)
  })
})

describe('the absolute session lifetime', () => {
  it('ends a session eight hours after sign-in, however active', async () => {
    const cookie = await sessionCookie({ lastActivity: Date.now(), authTime: Math.floor(Date.now() / 1000) - 9 * 3600 })
    const res = await proxy(request('/api/contacts', { cookie }))
    expect(res.status).toBe(401)
  })

  it('leaves a session inside its eight hours alone', async () => {
    const cookie = await sessionCookie({ lastActivity: Date.now(), authTime: Math.floor(Date.now() / 1000) - 3600 })
    expect(passed(await proxy(request('/api/contacts', { cookie })))).toBe(true)
  })
})

describe('a token with no lastActivity', () => {
  it('is idle from its sign-in time, not from its latest re-sign', async () => {
    const cookie = await sessionCookie({ authTime: Date.now() / 1000 - 20 * 60 })
    expect(passed(await proxy(request('/api/contacts', { cookie })))).toBe(false)
  })
})

describe('public prefixes end at a path boundary', () => {
  it.each(['/api/mcpanything', '/api/whatsapp/webhooks-admin', '/api/chatbot/cronjobs', '/api/rcs/webhookx', '/iconsettings'])(
    '%s is not public',
    async (path) => {
      const res = await proxy(request(path))
      expect(passed(res)).toBe(false)
    },
  )

  it.each([
    '/api/mcp',
    '/api/whatsapp/webhook',
    '/api/telegram/webhook/123',
    '/api/sms/webhook/abc',
    '/api/auth/register',
    '/f/token',
    '/icon',
    '/api/flows/0b8f2a8e-1111-2222-3333-444455556666/webhook',
  ])('%s is still public', async (path) => {
    const res = await proxy(request(path))
    expect(passed(res)).toBe(true)
  })
})

describe('every response carries the report-only policy', () => {
  it('on a redirect to login', async () => {
    const res = await proxy(request('/dashboard'))
    expect(res.headers.get('content-security-policy-report-only')).toContain("'nonce-")
  })
})
