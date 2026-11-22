import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Choosing one ad account on "From click to sale": only an ad account this
 * workspace connected; anything else is a plain 400 and nothing is read.
 */

const h = vi.hoisted(() => ({ calls: [] as Array<{ accountId: string; adAccountId?: string }> }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'owner' }), assertPageAccess: () => {} }
})
vi.mock('@/lib/meta-ads/access', () => ({ adsReadGate: () => null }))
vi.mock('@/lib/dashboard/scope', () => ({ resolveDashboardScope: async () => ({ money: true }) }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/db', () => ({
  prisma: { metaAdAccount: { findMany: async ({ where }: { where: { account_id: string } }) => (where.account_id === 'acc' ? [{ ad_account_id: '111', name: 'Main', currency: 'INR', is_default: true }, { ad_account_id: '222', name: 'Second', currency: 'INR', is_default: false }] : []) } },
}))
vi.mock('@/lib/ads/performance', () => ({
  adPerformance: async (a: { accountId: string; adAccountId?: string }) => { h.calls.push({ accountId: a.accountId, ...(a.adAccountId ? { adAccountId: a.adAccountId } : {}) }); return { ads: [], campaigns: [], totals: {}, findings: [] } },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/ads/performance?${qs}`))

beforeEach(() => { h.calls = [] })

describe('one ad account', () => {
  it('a connected account narrows the results and the list comes back for the picker', async () => {
    const res = await get('period=month&account=222')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ accountId: 'acc', adAccountId: '222' }])
    const body = (await res.json()) as { adAccounts: Array<{ id: string }>; account: string }
    expect(body.adAccounts.map((a) => a.id)).toEqual(['111', '222'])
    expect(body.account).toBe('222')
  })

  it('an account this workspace did not connect, or not an id: 400, nothing read', async () => {
    expect((await get('period=month&account=999')).status).toBe(400)
    expect((await get('period=month&account=act_111')).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('no account: all of them', async () => {
    await get('period=month')
    expect(h.calls).toEqual([{ accountId: 'acc' }])
  })
})
