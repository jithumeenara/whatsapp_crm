import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Choosing the Page / Instagram account (POST /api/meta/social-connect/finish):
 * only ids offered in this owner's own session, and a session works once.
 */

const SID = '00000000-0000-0000-0000-0000000000aa'
const h = vi.hoisted(() => ({ claims: 0, saved: [] as Array<{ page: unknown; instagram: unknown }> }))

vi.mock('@/lib/auth/account', () => ({ requireRole: async () => ({ accountId: 'acc-1', userId: 'owner-1' }), toErrorResponse: (e: Error) => new Response(e.message, { status: 500 }) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/social-connect', () => ({
  saveSocialConnection: async (a: { page: unknown; instagram: unknown }) => { h.saved.push(a); return { facebook: { connected: true }, instagram: null } },
}))
vi.mock('@/lib/meta/social-connect-server', () => ({
  loadSocialApp: async () => ({ appId: '1', appSecret: 's', configId: 'c' }),
  readConnectChoices: async () => null,
  claimConnectSession: async () => {
    h.claims++
    if (h.claims > 1) return null
    return { token: 'EAAbisu', pages: [{ id: '1029', name: 'ACSTI', igId: null, token: 'EAApage' }], instagram: [], scopes: [], expiresAt: null }
  },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('https://crm.example/api/meta/social-connect/finish', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { h.claims = 0; h.saved = [] })

describe('choosing what to connect', () => {
  it('a Page offered in the session is saved', async () => {
    const res = await post({ session: SID, page_id: '1029', instagram_id: null })
    expect(res.status).toBe(200)
    expect(h.saved[0].page).toMatchObject({ id: '1029' })
  })

  it('a Page that was not offered is refused (an id from the request alone is never enough)', async () => {
    const res = await post({ session: SID, page_id: '5555', instagram_id: null })
    expect(res.status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('the same session cannot be used twice (double click)', async () => {
    expect((await post({ session: SID, page_id: '1029' })).status).toBe(200)
    expect((await post({ session: SID, page_id: '1029' })).status).toBe(410)
    expect(h.saved).toHaveLength(1)
  })

  it('bad input is refused before anything is read', async () => {
    expect((await post({ session: 'not-a-uuid', page_id: '1029' })).status).toBe(400)
    expect((await post({ session: SID })).status).toBe(400)
    expect(h.claims).toBe(0)
  })
})
