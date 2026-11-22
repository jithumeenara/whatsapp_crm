import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Starting a one-click connect: owner only, a known channel only, and Meta
 * is opened with THAT channel's configuration; the channel is signed into
 * the state.
 */

const h = vi.hoisted(() => ({ configured: { instagram: 'IGCFG', facebook: null } as Record<string, string | null>, role: 'owner' }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => { if (h.role !== 'owner') throw Object.assign(new Error('forbidden'), { status: 403 }); return { accountId: 'acc-1', userId: 'owner-1' } },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }) }))
vi.mock('@/lib/meta/social-connect-server', () => ({
  CONNECT_CALLBACK_PATH: '/api/meta/social-connect/callback',
  connectOrigin: () => 'https://crm.example',
  loadSocialApp: async (channel?: string) => {
    const id = channel ? h.configured[channel] : null
    return id ? { appId: '123', appSecret: 'shh', configId: id } : null
  },
}))

import { POST } from './route'
import { verifyConnectState } from '@/lib/meta/connect-state'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-start' })
beforeEach(() => { h.role = 'owner'; h.configured = { instagram: 'IGCFG', facebook: null } })

const start = (body: unknown) => POST(new NextRequest('https://crm.example/api/meta/social-connect/start', { method: 'POST', body: JSON.stringify(body) }))

describe('start a one-click connect', () => {
  it('Connect Instagram opens Meta with the Instagram configuration, channel signed in the state', async () => {
    const res = await start({ channel: 'instagram' })
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    const u = new URL(url)
    expect(u.origin).toBe('https://www.facebook.com')
    expect(u.searchParams.get('config_id')).toBe('IGCFG')
    const nonce = /meta_connect_nonce=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
    expect(verifyConnectState(u.searchParams.get('state'), nonce)).toMatchObject({ channel: 'instagram', accountId: 'acc-1' })
  })

  it('a channel whose configuration is not set: a plain message, no Meta address', async () => {
    const res = await start({ channel: 'facebook' })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/Messenger configuration ID/)
  })

  it('unknown or missing channel: refused', async () => {
    for (const body of [{}, { channel: 'whatsapp' }, { channel: ['instagram'] }, null]) {
      expect((await start(body)).status).toBe(400)
    }
  })

  it('not the workspace owner: refused', async () => {
    h.role = 'admin'
    expect((await start({ channel: 'instagram' })).status).toBe(403)
  })
})
