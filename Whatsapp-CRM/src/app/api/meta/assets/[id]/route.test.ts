import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Default / check / remove one connected ad account or catalog: owner
 * only, this workspace's rows only (the lib looks them up with
 * account_id and answers false otherwise → 404), check is rate-limited.
 */

const ID = '00000000-0000-0000-0000-00000000aaaa'
const h = vi.hoisted(() => ({ role: 'owner', mine: true, calls: [] as string[], limited: false }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => { if (h.role !== 'owner') throw Object.assign(new Error('forbidden'), { status: 403 }); return { accountId: 'acc-1', userId: 'owner-1' } },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: !h.limited }) }))
vi.mock('@/lib/meta/social-connect-server', () => ({ loadMetaAppOnly: async () => ({ appId: '1', appSecret: 's' }) }))
vi.mock('@/lib/meta/asset-connect', () => ({
  setDefaultAsset: async (acc: string) => { h.calls.push(`default:${acc}`); return h.mine },
  checkAsset: async (acc: string) => { h.calls.push(`check:${acc}`); return h.mine },
  removeAsset: async (acc: string) => { h.calls.push(`remove:${acc}`); return h.mine },
}))

import { DELETE, PATCH } from './route'

const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const patch = (body: unknown, id = ID) => PATCH(new NextRequest(`https://x/api/meta/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), ctx(id))
const del = (kind = 'ads', id = ID) => DELETE(new NextRequest(`https://x/api/meta/assets/${id}?kind=${kind}`, { method: 'DELETE' }), ctx(id))

beforeEach(() => { h.role = 'owner'; h.mine = true; h.calls = []; h.limited = false })

describe('managing one connected asset', () => {
  it('make default / check / remove work on this workspace’s own rows (account_id from the session)', async () => {
    expect((await patch({ kind: 'ads', action: 'default' })).status).toBe(200)
    expect((await patch({ kind: 'catalog', action: 'check' })).status).toBe(200)
    expect((await del('ads')).status).toBe(200)
    expect(h.calls).toEqual(['default:acc-1', 'check:acc-1', 'remove:acc-1'])
  })

  it('another workspace’s row: 404, never a change', async () => {
    h.mine = false
    expect((await patch({ kind: 'ads', action: 'default' })).status).toBe(404)
    expect((await del('ads')).status).toBe(404)
  })

  it('not the owner: refused before anything runs', async () => {
    h.role = 'admin'
    expect((await patch({ kind: 'ads', action: 'default' })).status).toBe(403)
    expect((await del()).status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })

  it('bad id, kind or action: refused', async () => {
    expect((await patch({ kind: 'ads', action: 'default' }, 'not-a-uuid')).status).toBe(404)
    expect((await patch({ kind: 'pages', action: 'default' })).status).toBe(400)
    expect((await patch({ kind: 'ads', action: 'delete-everything' })).status).toBe(400)
    expect((await del('pages')).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('check is rate-limited', async () => {
    h.limited = true
    expect((await patch({ kind: 'ads', action: 'check' })).status).toBe(429)
    expect(h.calls).toHaveLength(0)
  })
})
