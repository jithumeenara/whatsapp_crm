import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** Who sees what: a lead's ad journey is read only inside the caller's own account. */

const LEAD = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({ leadWhere: null as Record<string, unknown> | null, touchWhere: null as Record<string, unknown> | null, lead: null as Record<string, unknown> | null }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }), assertPageAccess: () => {} }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findFirst: async ({ where }: { where: Record<string, unknown> }) => { h.leadWhere = where; return h.lead } },
    adTouch: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        h.touchWhere = where
        return [
          { channel: 'instagram', platform: 'instagram', ad_id: '120000000000002', post_id: null, headline: 'Second ad', media_url: null, touched_at: new Date('2026-11-05T10:00:00Z') },
          { channel: 'whatsapp', platform: null, ad_id: '120000000000001', post_id: null, headline: 'Diwali 50% off', media_url: null, touched_at: new Date('2026-11-01T10:00:00Z') },
        ]
      },
    },
    adCatalog: { findMany: async () => [{ ad_id: '120000000000001', ad_name: 'Diwali offer', adset_name: 'Kerala', campaign_name: 'November', thumbnail_url: null, effective_status: 'ACTIVE', platforms: 'facebook', error: null }] },
  },
}))

import { GET } from './route'

const call = (id: string) => GET(new NextRequest(`http://x/api/leads/${id}/ad-journey`), { params: Promise.resolve({ id }) })

beforeEach(() => { h.leadWhere = null; h.touchWhere = null; h.lead = { ad_id: '120000000000001', contact_id: 'c1', source: 'whatsapp' } })

describe('GET /api/leads/[id]/ad-journey', () => {
  it('loads the lead only within the caller\'s account, and the journey only for that account', async () => {
    const res = await call(LEAD)
    expect(res.status).toBe(200)
    expect(h.leadWhere).toEqual({ id: LEAD, account_id: 'acc' })
    expect(h.touchWhere).toEqual({ account_id: 'acc', contact_id: 'c1' })
    const body = await res.json()
    expect(body.ad).toMatchObject({ adId: '120000000000001', adName: 'Diwali offer', campaignName: 'November', channel: 'whatsapp', headline: 'Diwali 50% off' })
    expect(body.touches).toHaveLength(2)
    // A WhatsApp click with no certain link: the ad set shows only on Facebook, so it was seen there.
    expect(body.ad.seenOn).toBe('facebook')
    expect(body.touches[0].seenOn).toBe('instagram')
    expect(JSON.stringify(body)).not.toContain('click')
  })

  it('another account\'s lead is simply not found', async () => {
    h.lead = null
    expect((await call(LEAD)).status).toBe(404)
  })

  it('a malformed id is not found, without a database call', async () => {
    expect((await call('../x')).status).toBe(404)
    expect(h.leadWhere).toBeNull()
  })
})
