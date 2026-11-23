import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug seen live 2026-11-22: the Page's instant reply ("Hi, Thanks for
 * contacting us…") appeared in the Inbox once as the business and once
 * more as if the CUSTOMER had sent it. A message the Page sent — marked by
 * is_echo, by an app_id (only echoes carry one), or by the Page as sender
 * (the saved Page or the webhook entry's Page) — is the business's, never
 * a customer message.
 */

const h = vi.hoisted(() => ({ echoes: 0, inbound: 0 }))

vi.mock('@/lib/social/webhook-secrets', () => ({
  socialWebhookScope: async () => ({ all: true }),
  scopeAllows: () => true,
  sameToken: () => false,
  platformVerifyTokenMatches: async () => false,
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/conversions', () => ({ reportConversion: async () => {} }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: async () => {} }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: async () => {} }))
vi.mock('@/lib/audit/actors', () => ({ webhookRejected: () => {}, webhookWrote: async () => {} }))
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))
vi.mock('@/lib/meta/social-inbound', () => ({
  saveSocialEcho: async () => { h.echoes++; return null },
  applySocialEdit: async () => {}, applySocialReaction: async () => {}, noteBusinessAiHandoff: async () => {},
  attachmentsToRows: () => [], replyTargetId: async () => null,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    // The saved Page id differs from the entry's Page (two Pages in one portfolio).
    $queryRaw: async () => [{ account_id: 'acc', access_token: 'sealed:T', verify_token: null, page_id: '111' }],
    $executeRaw: async () => 0,
    contact: {
      findFirst: async () => ({ id: 'contact-1' }),
      upsert: async () => { h.inbound++; return { id: 'contact-1' } },
    },
    conversation: { findFirst: async () => ({ id: 'conv-1' }) },
    message: { findFirst: async () => null },
    user: { findFirst: async () => ({ id: 'owner' }) },
    account: { findUnique: async () => ({ owner_id: 'owner' }) },
  },
}))

import { POST } from './route'

const post = (messaging: unknown[]) => POST(new NextRequest('https://x/api/facebook/webhook', {
  method: 'POST',
  body: JSON.stringify({ object: 'page', entry: [{ id: '222', time: 1, messaging }] }),
}))
const settle = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => { h.echoes = 0; h.inbound = 0 })

describe('a message the Page sent is never the customer’s', () => {
  it('an instant reply with an app_id but no is_echo flag', async () => {
    await post([{ sender: { id: '27453671160961579' }, recipient: { id: '27453671160961579' }, timestamp: 1, message: { mid: 'm1', text: 'Hi, Thanks for contacting us.', app_id: 263902037430900 } }])
    await settle()
    expect(h.inbound).toBe(0)
    expect(h.echoes).toBe(1)
  })

  it('sent by the webhook entry’s Page even when the saved Page id differs', async () => {
    await post([{ sender: { id: '222' }, recipient: { id: '27453671160961579' }, timestamp: 1, message: { mid: 'm2', text: 'Away message' } }])
    await settle()
    expect(h.inbound).toBe(0)
    expect(h.echoes).toBe(1)
  })
})
