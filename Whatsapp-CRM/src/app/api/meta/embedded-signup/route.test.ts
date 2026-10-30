import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug (security audit 2026-10, A7): Quick Connect saved whatever wabaId
 * and phoneNumberId the browser posted next to the token exchanged from
 * the signup code. Nothing checked that this token can actually reach
 * that WABA and that number, so a crafted request could attach a number
 * id the person never granted. The number must now be listed under the
 * WABA *for this token* before anything is saved or registered.
 */

const h = vi.hoisted(() => ({ wabaNumbers: [] as string[], registered: 0, saved: 0 }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'a1', userId: 'u1', role: 'owner' }) }
})
vi.mock('@/lib/whatsapp/meta-platform-config', () => ({ loadMetaPlatformConfig: async () => ({ appId: 'app', appSecret: 's' }) }))
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))
vi.mock('@/lib/meta-ads/api', () => ({ createOrGetDataset: async () => ({ datasetId: 'd' }) }))
vi.mock('@/lib/whatsapp/catalog-api', () => ({ listOwnedCatalogs: async () => [] }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  exchangeEmbeddedSignupCode: async () => ({ accessToken: 'business-token' }),
  subscribeWabaToApp: async () => {},
  registerPhoneNumber: async () => {
    h.registered++
  },
  verifyPhoneNumber: async () => ({}),
  listWabaPhoneNumberIds: async () => h.wabaNumbers,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: {
      findFirst: async () => null,
      count: async () => 0,
      create: async () => {
        h.saved++
        return {}
      },
      update: async () => ({}),
    },
    metaAdsConfig: { upsert: async () => ({}) },
    catalogConfig: { upsert: async () => ({}) },
    $executeRaw: async () => 0,
  },
}))

const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string) => {
  // Graph: which numbers live under this WABA for this token.
  const m = /\/v[\d.]+\/([^/?]+)\/phone_numbers/.exec(String(url))
  if (m) return Response.json({ data: h.wabaNumbers.map((id) => ({ id })) })
  return Response.json({ data: [] })
}) as typeof fetch
void realFetch

import { POST } from './route'

const signup = (body: Record<string, string>) =>
  POST(new NextRequest('http://x/api/meta/embedded-signup', { method: 'POST', body: JSON.stringify(body) }))

describe('Quick Connect — the number must be one this token was granted', () => {
  beforeEach(() => {
    h.registered = 0
    h.saved = 0
  })

  it('refuses a phone number id that is not under the granted WABA', async () => {
    h.wabaNumbers = ['111']
    const res = await signup({ code: 'c', wabaId: 'waba-1', phoneNumberId: '999-someone-elses' })
    expect(res.status).toBe(403)
    expect(h.registered).toBe(0)
    expect(h.saved).toBe(0)
  })

  it('connects a number the token can reach', async () => {
    h.wabaNumbers = ['111']
    const res = await signup({ code: 'c', wabaId: 'waba-1', phoneNumberId: '111' })
    expect(res.status).toBe(200)
    expect(h.saved).toBe(1)
  })
})
