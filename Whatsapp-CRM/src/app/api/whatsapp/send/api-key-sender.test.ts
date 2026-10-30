/**
 * Security review 2026-10 (A2-15 / N8): a send made with an API key was
 * attributed to the account's EARLIEST member — whoever joined first,
 * possibly an agent or someone since removed — not to the person who minted
 * the key. Keys now act as their creator everywhere (requireRoleOrApiKey);
 * this route follows. A key with no recorded creator is refused by
 * verifyApiKey (N2), so it never reaches attribution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  key: null as null | { accountId: string; keyId: string; creatorUserId: string },
  senderId: undefined as unknown,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/api-key', () => ({ verifyApiKey: async () => h.key }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      // The old attribution: earliest member of the account.
      findFirst: async () => ({ user_id: 'earliest-member' }),
      findUnique: async () => null,
    },
    conversation: {
      findFirst: async ({ where }: { where: { account_id: string } }) =>
        where.account_id === 'acc' ? { id: 'c1', channel: 'website', contact: {} } : null,
    },
  },
}))
vi.mock('@/lib/webchat/outbound', () => ({
  sendToWebsiteVisitor: async (args: { senderId: unknown }) => {
    h.senderId = args.senderId
    return { id: 'm1' }
  },
}))

import { POST } from './route'

const send = () =>
  POST(
    new Request('http://x/api/whatsapp/send', {
      method: 'POST',
      headers: { authorization: `Bearer wcrm_${'a'.repeat(64)}` },
      body: JSON.stringify({ conversation_id: 'c1', message_type: 'text', content_text: 'hi' }),
    }),
  )

beforeEach(() => {
  h.senderId = undefined
})

describe('whatsapp/send with an API key', () => {
  it('is attributed to the key’s creator, not the earliest member', async () => {
    h.key = { accountId: 'acc', keyId: 'k', creatorUserId: 'creator-9' }
    const res = await send()
    expect(res.status).toBe(200)
    expect(h.senderId).toBe('creator-9')
  })
  it('a refused key (revoked, expired, creatorless, creator gone) sends nothing', async () => {
    h.key = null
    expect((await send()).status).toBe(401)
    expect(h.senderId).toBeUndefined()
  })
})
