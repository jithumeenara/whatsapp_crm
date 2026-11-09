import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: the Meta Ads read routes asked only for the lowest role ('viewer'),
 * with no page grant and no rate limit. Any signed-in member, an agent who
 * was never given the Ads page included, could call them directly and read
 * the ad spend and the lead names and phone numbers behind it, and each call
 * made the server reach out to Meta.
 *
 * The menu hid the Ads page; that was the whole of the protection.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  pageAccess: null as unknown,
  userId: 'u1',
  dbCalls: 0,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () =>
    Promise.resolve({ userId: h.userId, accountId: 'acc-1', role: h.role, pageAccess: h.pageAccess }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token', encrypt: () => 'enc' }))
vi.mock('@/lib/meta-ads/api', () => ({
  fetchAdAccountInsights: () => Promise.resolve(null),
  testMetaAdsConnection: () => Promise.resolve({ ok: true, message: 'ok' }),
  createOrGetDataset: () => Promise.resolve({ datasetId: 'd' }),
}))
vi.mock('@/lib/meta-ads/ad-leads', () => ({
  countAdLeads: () => Promise.resolve({ form: 0, clickToWhatsApp: 0 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: () => Promise.resolve() }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: () => Promise.resolve() }))

vi.mock('@/lib/db', () => {
  const counted = <T,>(value: T) => () => {
    h.dbCalls += 1
    return Promise.resolve(value)
  }
  return {
    prisma: {
      metaAdsConfig: {
        findUnique: counted({
          status: 'connected',
          ad_account_id: null,
          access_token: 'enc',
          pixel_id: 'px',
          web_events_secret: 'SECRET-VALUE',
          dataset_id: null,
        }),
      },
      conversation: { count: counted(0) },
      leadAdSubmission: { count: counted(0), findMany: counted([]), groupBy: counted([]) },
      lead: { count: counted(0) },
      leadAdForm: { findMany: counted([]) },
    },
  }
})

import { GET as dashboardGET } from './dashboard/route'
import { GET as configGET } from './config/route'
import { GET as pixelGET } from './pixel/route'
import { GET as leadFormsGET } from './lead-forms/route'

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ['dashboard', () => dashboardGET()],
  ['config', () => configGET()],
  ['pixel', () => pixelGET()],
  ['lead-forms', () => leadFormsGET()],
]

beforeEach(() => {
  h.role = 'agent'
  h.pageAccess = null
  h.userId = `u-${Math.random()}`
  h.dbCalls = 0
})

describe('Meta Ads read routes: page access', () => {
  for (const [name, call] of ROUTES) {
    it(`${name}: an agent who was not given the Ads page is refused before any data is read`, async () => {
      const res = await call()
      expect(res.status).toBe(403)
      expect(h.dbCalls).toBe(0)
    })

    it(`${name}: an admin is let in`, async () => {
      h.role = 'admin'
      const res = await call()
      expect(res.status).not.toBe(403)
    })
  }
})

describe('Meta Ads read routes: rate limit', () => {
  it('dashboard: the sixty-first call in a minute from one person is turned away', async () => {
    h.role = 'admin'
    let last = 200
    for (let i = 0; i < 61; i++) last = (await dashboardGET()).status
    expect(last).toBe(429)
  })
})

describe('pixel secret', () => {
  it('is shown to an admin but not to a supervisor who was given the Ads page', async () => {
    h.role = 'supervisor'
    h.pageAccess = ['/ads']
    const res = await pixelGET()
    const body = JSON.stringify(await res.json().catch(() => ({})))
    expect(body).not.toContain('SECRET-VALUE')

    h.role = 'admin'
    h.pageAccess = null
    const adminBody = JSON.stringify(await (await pixelGET()).json())
    expect(adminBody).toContain('SECRET-VALUE')
  })
})
