import { describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): the Twilio webhook picked the account with
 * findFirst on the receiving number / Messaging Service SID — values any
 * account owner can type into their own RCS settings. A second account
 * claiming a business's number got its real, Twilio-signed messages
 * checked against the wrong auth token (401: the business stops receiving
 * texts), or, by row order, could receive them. Now every account that
 * claims the number is tried, and only the one whose own auth token
 * verifies Twilio's signature gets the message.
 */

const h = vi.hoisted(() => ({ processed: [] as string[] }))

vi.mock('@/lib/db', () => ({
  prisma: {
    rcsConfig: {
      findFirst: async () => ({ account_id: 'squatter', user_id: 'u2', account_sid: 'AC2', auth_token: 'tok-squatter' }),
      findMany: async () => [
        { account_id: 'squatter', user_id: 'u2', account_sid: 'AC2', auth_token: 'tok-squatter' },
        { account_id: 'business', user_id: 'u1', account_sid: 'AC1', auth_token: 'tok-business' },
      ],
    },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/messaging/channels/rcs', () => ({
  // Twilio signed with the business's own token.
  verifyTwilioSignature: (a: { authToken: string; signature: string | null }) =>
    a.signature === 'sig' && a.authToken === 'tok-business',
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/contacts/dedupe', () => ({ findExistingContact: async () => null, isUniqueViolation: () => false }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: async () => ({ consumed: true }) }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: async () => {} }))
vi.mock('@/lib/whatsapp/phone-utils', () => ({
  normalizePhone: (p: string) => {
    h.processed.push(p)
    return null // stop after the account is chosen
  },
}))

import { POST } from './route'
import { NextRequest } from 'next/server'

const twilioPost = (sig: string) =>
  new NextRequest('https://crm.example.com/api/rcs/webhook', {
    method: 'POST',
    headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: '+14155550100', From: '+919847012345', Body: 'hi', MessageSid: 'SM1' }).toString(),
  })

describe('RCS webhook — which account a Twilio message belongs to', () => {
  it("delivers to the account whose auth token verifies, even when another claims the number first", async () => {
    const res = await POST(twilioPost('sig'))
    expect(res.status).toBe(200)
  })

  it('refuses a request no claimant’s token verifies', async () => {
    const res = await POST(twilioPost('forged'))
    expect(res.status).toBe(401)
  })
})
