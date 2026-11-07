import { beforeEach, describe, expect, it, vi } from 'vitest'

// An auto-created lead records the WhatsApp number and the ad its first
// message came from (reports, migration 158).

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  origin: { whatsapp_config_id: 'wa-1', ad_id: 'ad-42' } as { whatsapp_config_id: string | null; ad_id: string | null },
  originArgs: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    leadSettings: { findUnique: async () => ({ auto_lead_creation: true }) },
    lead: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return { id: 'lead-1', ...data }
      },
    },
    leadActivity: { create: async () => ({}) },
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/audit/actors', () => ({ webhookWrote: async () => {} }))
vi.mock('./origin', () => ({
  leadOrigin: async (args: Record<string, unknown>) => {
    h.originArgs.push(args)
    return h.origin
  },
}))

import { autoCreateLead } from './auto-create'

beforeEach(() => {
  h.created = []
  h.originArgs = []
  h.origin = { whatsapp_config_id: 'wa-1', ad_id: 'ad-42' }
})

describe('autoCreateLead', () => {
  it('saves the number and the ad on the new lead, keeping its source', async () => {
    await autoCreateLead({ accountId: 'acc', userId: 'owner', contactId: 'c1', title: 'Anu', source: 'whatsapp', conversationId: 'conv-1' })
    expect(h.originArgs[0]).toEqual({ accountId: 'acc', contactId: 'c1', conversationId: 'conv-1' })
    expect(h.created[0]).toMatchObject({ account_id: 'acc', contact_id: 'c1', source: 'whatsapp', whatsapp_config_id: 'wa-1', ad_id: 'ad-42' })
  })

  it('a lead with no known origin is still created, with empty values', async () => {
    h.origin = { whatsapp_config_id: null, ad_id: null }
    await autoCreateLead({ accountId: 'acc', userId: 'owner', contactId: 'c1', title: 'Anu', source: 'website' })
    expect(h.created[0]).toMatchObject({ source: 'website', whatsapp_config_id: null, ad_id: null })
  })
})
