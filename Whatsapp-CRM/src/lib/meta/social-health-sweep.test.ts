import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The connection health sweep (server.ts, every few hours): a dead Meta
 * token is marked and the owners are told once; Instagram Login tokens are
 * renewed before their 60 days end. Imported by server.ts, so it must not
 * pull in next/server (see the sweep-imports guard tests).
 */

const h = vi.hoisted(() => ({
  fb: [] as Array<Record<string, unknown>>,
  ig: [] as Array<Record<string, unknown>>,
  updates: [] as string[],
  notified: [] as string[],
  valid: true,
  changed: 1,
}))

vi.mock('@/lib/admin-chat/notify', () => ({ notifyAdmins: async (a: { title: string }) => { h.notified.push(a.title) } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string) => v, sealSecret: (v: string) => `sealed(${v})`, decrypt: (v: string) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaPlatformConfig: { findUnique: async () => ({ app_id: '1', app_secret: 's' }) },
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      const rows = sql.includes('FROM facebook_config') ? h.fb : h.ig
      return Object.assign(Promise.resolve(rows), { catch: () => Promise.resolve(rows) })
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.updates.push(strings.join('?') + JSON.stringify(values)); return h.changed },
  },
}))

import { needsIgRefresh, sweepSocialConnections } from './social-health-sweep'

const now = new Date('2026-11-16T00:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * 86_400_000)

beforeEach(() => {
  h.fb = []; h.ig = []; h.updates = []; h.notified = []; h.valid = true; h.changed = 1
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u)
    if (url.pathname.endsWith('/debug_token')) return new Response(JSON.stringify({ data: { is_valid: h.valid, scopes: [] } }), { status: 200 })
    if (url.pathname.endsWith('/refresh_access_token')) return new Response(JSON.stringify({ access_token: 'IGAAnew', expires_in: 5_184_000 }), { status: 200 })
    return new Response('{}', { status: 404 })
  }))
})

describe('when to renew an Instagram Login token', () => {
  it('not within a day of the last change; yes within 10 days of expiry or when unknown', () => {
    expect(needsIgRefresh(days(5), days(-0.5), now)).toBe(false)
    expect(needsIgRefresh(days(5), days(-2), now)).toBe(true)
    expect(needsIgRefresh(days(40), days(-2), now)).toBe(false)
    expect(needsIgRefresh(null, days(-2), now)).toBe(true)
  })
})

describe('connection health sweep', () => {
  it('a Meta token that stopped: marked error, owners told once', async () => {
    h.fb = [{ account_id: 'acc-1', access_token: 'EAAdead', token_kind: 'page', token_expires_at: null, updated_at: days(-3) }]
    h.valid = false
    const r = await sweepSocialConnections(now)
    expect(r.broken).toBe(1)
    expect(h.updates.join()).toMatch(/status = 'error'/)
    expect(h.notified).toEqual(['Messenger stopped working'])

    // Already marked (the conditional update changes nothing): no second push.
    h.changed = 0
    h.notified = []
    await sweepSocialConnections(now)
    expect(h.notified).toEqual([])
  })

  it('a working token: nothing changed', async () => {
    h.fb = [{ account_id: 'acc-1', access_token: 'EAAok', token_kind: 'page', token_expires_at: null, updated_at: days(-3) }]
    const r = await sweepSocialConnections(now)
    expect(r).toMatchObject({ checked: 1, broken: 0 })
    expect(h.updates).toEqual([])
  })

  it('an Instagram Login token near its end is renewed and stored sealed with the new expiry', async () => {
    h.ig = [{ account_id: 'acc-2', access_token: 'IGAAold', token_kind: 'instagram_login', token_expires_at: days(3), updated_at: days(-50) }]
    const r = await sweepSocialConnections(now)
    expect(r.refreshed).toBe(1)
    expect(h.updates.join()).toContain('sealed(IGAAnew)')
  })
})
