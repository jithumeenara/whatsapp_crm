import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reports (migration 158): a lead typed in on the Leads page records the
 * WhatsApp number and click-to-WhatsApp ad from the contact's own chats
 * in this account — never values sent in the request body.
 */

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  convWheres: [] as Array<Record<string, unknown>>,
  conv: null as null | { whatsapp_config_id: string | null; ctwa_source_id: string | null },
}))

vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: 'admin' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/leads/owned-refs', () => ({ checkOwnedRefs: () => Promise.resolve(null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: ({ where }: { where: { id: string; account_id: string } }) =>
        Promise.resolve(where.account_id === 'acc' && where.id === 'c1' ? { id: 'c1' } : null),
    },
    conversation: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        h.convWheres.push(where)
        return Promise.resolve(where.account_id === 'acc' && where.contact_id === 'c1' ? h.conv : null)
      },
    },
    lead: {
      findMany: () => Promise.resolve([]),
      create: ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return Promise.resolve({ id: 'lead-1', ...data })
      },
    },
    leadActivity: { create: () => Promise.resolve({}) },
  },
}))

import { POST } from './route'

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/leads', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  h.created = []
  h.convWheres = []
  h.conv = { whatsapp_config_id: 'wa-1', ctwa_source_id: 'ad-42' }
})

describe('POST /api/leads records where the lead came from', () => {
  it('copies the number and the ad from the contact’s chat, keeping the source', async () => {
    const res = await post({ title: 'Anu', contact_id: 'c1', source: 'referral' })
    expect(res.status).toBe(201)
    expect(h.created[0]).toMatchObject({ contact_id: 'c1', source: 'referral', whatsapp_config_id: 'wa-1', ad_id: 'ad-42' })
    expect(h.convWheres.every((w) => w.account_id === 'acc')).toBe(true)
  })

  it('ignores a number or an ad sent in the body', async () => {
    h.conv = null
    const res = await post({ title: 'Anu', contact_id: 'c1', whatsapp_config_id: 'someone-elses-number', ad_id: 'made-up' })
    expect(res.status).toBe(201)
    expect(h.created[0]).toMatchObject({ whatsapp_config_id: null, ad_id: null })
  })

  it('a lead with no contact has no origin', async () => {
    const res = await post({ title: 'Walk-in' })
    expect(res.status).toBe(201)
    expect(h.created[0]).toMatchObject({ contact_id: null, whatsapp_config_id: null, ad_id: null })
    expect(h.convWheres).toHaveLength(0)
  })
})
