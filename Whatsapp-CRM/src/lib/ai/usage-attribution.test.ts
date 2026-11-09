import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AI cost per person and per channel. Every call used to be recorded for the
 * account as a whole, so "what did this team member's AI drafts cost" could
 * not be answered. A call now says who it was for and which conversation; the
 * channel and the WhatsApp number come from that conversation. A call made
 * for nobody in particular stays unattributed rather than guessed.
 */

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, any>>,
  conversation: null as null | { channel: string; whatsapp_config_id: string | null },
  conversationWhere: null as any,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    aiUsageEvent: {
      create: ({ data }: { data: Record<string, any> }) => {
        h.created.push(data)
        return Promise.resolve(data)
      },
    },
    conversation: {
      findFirst: ({ where }: any) => {
        h.conversationWhere = where
        return Promise.resolve(h.conversation)
      },
    },
  },
}))

import { recordAiUsage } from './usage'

const call = { accountId: 'acc-A', model: 'gemini-3.6-flash', feature: 'chat_customer' as const }

beforeEach(() => {
  h.created = []
  h.conversation = { channel: 'whatsapp', whatsapp_config_id: 'num-1' }
  h.conversationWhere = null
})

describe('recordAiUsage attribution', () => {
  it('records the person and the conversation, with its channel and number', async () => {
    await recordAiUsage({ ...call, userId: 'user-1', conversationId: 'conv-1' })
    expect(h.created[0]).toMatchObject({
      user_id: 'user-1',
      conversation_id: 'conv-1',
      channel: 'whatsapp',
      whatsapp_config_id: 'num-1',
    })
  })

  it('looks the conversation up inside the business only', async () => {
    await recordAiUsage({ ...call, conversationId: 'conv-1' })
    expect(JSON.stringify(h.conversationWhere)).toContain('acc-A')
  })

  it('leaves a call made for nobody unattributed', async () => {
    await recordAiUsage(call)
    expect(h.created[0]).toMatchObject({ user_id: null, conversation_id: null, channel: null, whatsapp_config_id: null })
  })

  it('still records the call when the conversation cannot be found', async () => {
    h.conversation = null
    await recordAiUsage({ ...call, userId: 'user-1', conversationId: 'gone' })
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ user_id: 'user-1', channel: null })
  })

  it('takes an explicit channel without a lookup', async () => {
    await recordAiUsage({ ...call, userId: 'user-1', channel: 'telegram' })
    expect(h.created[0].channel).toBe('telegram')
    expect(h.conversationWhere).toBeNull()
  })
})
