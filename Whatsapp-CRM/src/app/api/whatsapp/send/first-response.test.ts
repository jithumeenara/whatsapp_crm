/**
 * Reports (migration 158): a staff member's own send stamps the contact's
 * leads with their first response. An API-key send does not — it is an
 * integration acting under its creator's name, not a person replying —
 * and a send that failed or was refused stamps nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  key: null as null | { accountId: string; keyId: string; creatorUserId: string },
  session: null as null | { user: { id: string } },
  stamps: [] as Array<Record<string, unknown>>,
  sendFails: false,
}))

vi.mock('@/auth', () => ({ auth: async () => h.session }))
vi.mock('@/lib/auth/api-key', () => ({ verifyApiKey: async () => h.key }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findUnique: async ({ where }: { where: { user_id: string } }) =>
        where.user_id === 'agent-1' ? { account_id: 'acc', account_role: 'admin' } : null,
    },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; account_id: string } }) =>
        where.account_id === 'acc' && where.id === 'c1'
          ? { id: 'c1', contact_id: 'contact-1', channel: 'website', contact: {} }
          : null,
    },
  },
}))
vi.mock('@/lib/webchat/outbound', () => ({
  sendToWebsiteVisitor: async () => {
    if (h.sendFails) throw new Error('socket down')
    return { id: 'm1' }
  },
}))
vi.mock('@/lib/leads/first-response', () => ({
  stampFirstResponse: async (args: Record<string, unknown>) => {
    h.stamps.push(args)
    return 1
  },
}))

import { POST } from './route'

const send = (headers: Record<string, string> = {}, conversationId = 'c1') =>
  POST(
    new Request('http://x/api/whatsapp/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversation_id: conversationId, message_type: 'text', content_text: 'hi' }),
    }),
  )

beforeEach(() => {
  h.key = null
  h.session = null
  h.stamps = []
  h.sendFails = false
})

describe('first response from a person', () => {
  it('a signed-in staff member’s send stamps the contact’s leads, in their account', async () => {
    h.session = { user: { id: 'agent-1' } }
    const res = await send()
    expect(res.status).toBe(200)
    expect(h.stamps).toEqual([{ accountId: 'acc', contactId: 'contact-1', userId: 'agent-1' }])
  })

  it('an API-key send does not count as a person replying', async () => {
    h.key = { accountId: 'acc', keyId: 'k', creatorUserId: 'creator-9' }
    const res = await send({ authorization: `Bearer wcrm_${'a'.repeat(64)}` })
    expect(res.status).toBe(200)
    expect(h.stamps).toHaveLength(0)
  })

  it('a chat outside the account stamps nothing', async () => {
    h.session = { user: { id: 'agent-1' } }
    const res = await send({}, 'not-mine')
    expect(res.status).toBe(404)
    expect(h.stamps).toHaveLength(0)
  })

  it('a send that failed stamps nothing', async () => {
    h.session = { user: { id: 'agent-1' } }
    h.sendFails = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await send()
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.stamps).toHaveLength(0)
    err.mockRestore()
  })
})
