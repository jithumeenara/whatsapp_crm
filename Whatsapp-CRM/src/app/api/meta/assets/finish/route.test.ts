import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Choosing ad accounts / catalogs after Meta: only ids offered in this
 * owner's own session, at most 50, digits only; the session works once.
 */

const SID = '00000000-0000-0000-0000-0000000000bb'
const h = vi.hoisted(() => ({ claims: 0, saved: [] as Array<{ assets: Array<{ id: string }>; kind: string }> }))

vi.mock('@/lib/auth/account', () => ({ requireRole: async () => ({ accountId: 'acc-1', userId: 'owner-1' }), toErrorResponse: (e: Error) => new Response(e.message, { status: 500 }) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/asset-connect', () => ({
  MAX_ASSETS: 50,
  readAssetChoices: async () => null,
  claimAssetSession: async () => {
    h.claims++
    if (h.claims > 1) return null
    return { token: 'EAAtok', kind: 'ads', scopes: ['ads_read'], assets: [{ id: '111', name: 'A' }, { id: '222', name: 'B' }] }
  },
  saveAssets: async (a: { assets: Array<{ id: string }>; kind: string }) => { h.saved.push(a); return { saved: a.assets.length } },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('https://crm.example/api/meta/assets/finish', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { h.claims = 0; h.saved = [] })

describe('choosing ad accounts', () => {
  it('several offered ids are saved together', async () => {
    const res = await post({ session: SID, ids: ['111', '222'] })
    expect(res.status).toBe(200)
    expect(h.saved[0].assets.map((a) => a.id)).toEqual(['111', '222'])
  })

  it('an id that was not offered is refused, nothing saved', async () => {
    const res = await post({ session: SID, ids: ['111', '999'] })
    expect(res.status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('the same session cannot be used twice', async () => {
    expect((await post({ session: SID, ids: ['111'] })).status).toBe(200)
    expect((await post({ session: SID, ids: ['111'] })).status).toBe(410)
    expect(h.saved).toHaveLength(1)
  })

  it('bad input is refused before the session is touched', async () => {
    for (const body of [{ session: 'x', ids: ['111'] }, { session: SID, ids: [] }, { session: SID, ids: ['act_111'] }, { session: SID, ids: Array.from({ length: 51 }, (_, i) => String(i + 1)) }, { session: SID, ids: [111] }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(h.claims).toBe(0)
  })
})
