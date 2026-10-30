import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Broadcasts: who may reach them, and what a campaign may attach.
 *
 *  - The list and the create route asked for the Broadcasts page; the
 *    per-broadcast routes did not, so a member the admin had kept off the
 *    page (every agent, by default) could still download a campaign's
 *    recipients — names, numbers, emails — as a spreadsheet, or send one.
 *  - The header image is read from the server's own disk when it is an
 *    /api/files/… path, and uploaded to Meta. Any path was accepted, so a
 *    campaign could name another workspace's file and send it to itself.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  pages: null as string[] | null,
  created: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const db = (await import('@/lib/db')).prisma
  const ctx = () => ({ accountId: 'acc', userId: 'u1', role: h.role, pageAccess: h.pages, db })
  return {
    ...actual,
    requireRole: async () => ctx(),
    requireRoleOrApiKey: async () => ctx(),
    toErrorResponse: actual.toErrorResponse,
  }
})
vi.mock('@/auth', () => ({ auth: () => Promise.resolve(null) }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('UTC') }))
vi.mock('@/lib/db', () => ({
  prisma: {
    broadcast: {
      findFirst: () => Promise.resolve({ id: 'b1', name: 'Diwali' }),
      create: (a: { data: Record<string, unknown> }) => { h.created = a.data; return Promise.resolve({ id: 'b2', ...a.data }) },
    },
    broadcastRecipient: {
      findMany: () => Promise.resolve([{ status: 'sent', error_message: null, sent_at: new Date(), delivered_at: null, read_at: null, replied_at: null, contact: { name: 'Asha', phone: '+919800000000', email: null } }]),
    },
  },
}))

import { NextRequest } from 'next/server'

// exceljs is heavy to load on a busy machine; the default 5 s is not about this test.
vi.setConfig({ testTimeout: 30_000 })
import { GET as exportXlsx } from './[id]/export/route'
import { POST as saveDraft } from './draft/route'

const exp = () => exportXlsx(new NextRequest('http://x/api/broadcasts/b1/export'), { params: Promise.resolve({ id: 'b1' }) })
const draft = (header_media_url: string) =>
  saveDraft(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'D', template_name: 't', header_media_url }) }) as never)

describe('broadcast access', () => {
  beforeEach(() => {
    h.created = null
    h.pages = null
  })

  it('an agent without the Broadcasts page cannot export the recipients', async () => {
    h.role = 'agent'
    expect((await exp()).status).toBe(403)
  })

  it('a supervisor, or an agent given the page, can', async () => {
    h.role = 'supervisor'
    expect((await exp()).status).toBe(200)
    h.role = 'agent'
    h.pages = ['/broadcasts']
    expect((await exp()).status).toBe(200)
  })

  it('a header image from another workspace’s folder is refused', async () => {
    h.role = 'supervisor'
    expect((await draft('/api/files/account-other/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed-id.jpg')).status).toBe(400)
    expect((await draft('/api/files/../../.env')).status).toBe(400)
    expect(h.created).toBeNull()
  })

  it('the account’s own upload, or a public https link, is kept', async () => {
    h.role = 'supervisor'
    expect((await draft('/api/files/account-acc/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed-banner.jpg')).status).toBe(201)
    expect(h.created?.header_media_url).toBe('/api/files/account-acc/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed-banner.jpg')
    expect((await draft('https://cdn.example.com/banner.jpg')).status).toBe(201)
  })
})
