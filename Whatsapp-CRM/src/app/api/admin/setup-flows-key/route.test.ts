import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Any signed-in member — a viewer included — could replace the account's
 * WhatsApp Flows encryption key at Meta, and, being a GET, so could any
 * page that merely linked to it while they were signed in. It is the
 * WhatsApp configuration, which is the owner's (canEditWhatsAppConfig).
 */

const h = vi.hoisted(() => ({ role: 'viewer', fetched: 0 }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: `u-${h.role}` } }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findUnique: () =>
        Promise.resolve({ account_id: 'acc', account_role: h.role, account: { id: 'acc', name: 'A' }, page_access: null }),
    },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'tok' }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  resolveWhatsAppConfig: () => Promise.resolve({ phone_number_id: 'p', access_token: 'x' }),
}))

import { GET } from './route'

describe('uploading the Flows key', () => {
  beforeEach(() => {
    h.fetched = 0
    vi.stubGlobal('fetch', () => {
      h.fetched++
      return Promise.resolve(new Response('{"success":true}', { status: 200 }))
    })
  })

  for (const role of ['viewer', 'agent', 'supervisor', 'admin']) {
    it(`is refused to a ${role}`, async () => {
      h.role = role
      expect((await GET()).status).toBe(403)
      expect(h.fetched).toBe(0)
    })
  }

  it('is allowed to the owner', async () => {
    h.role = 'owner'
    expect((await GET()).status).toBe(200)
    expect(h.fetched).toBe(1)
  })
})
