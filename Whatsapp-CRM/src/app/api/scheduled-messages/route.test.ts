import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A website chat has no 24-hour window and no templates. Scheduling a
 * message to one used to demand "a Meta-approved template", which a
 * website visitor cannot even be shown.
 */

const h = vi.hoisted(() => ({
  channel: 'website' as string,
  created: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'u1' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/email/conversation-send', () => ({ cleanSubject: () => '', parseAddresses: () => [] }))
vi.mock('@/lib/email/schema', () => ({ ensureEmailColumns: () => Promise.resolve() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findFirst: (a: { where: { channel?: string } }) => {
        if (a.where.channel && a.where.channel !== h.channel) return Promise.resolve(null)
        return Promise.resolve({ id: 'c1', contact_id: 'k1', channel: h.channel })
      },
    },
    messageTemplate: { findFirst: () => Promise.resolve(null) },
    scheduledMessage: {
      create: (a: { data: Record<string, unknown> }) => {
        h.created = a.data
        return Promise.resolve({ id: 's1', ...a.data })
      },
    },
  },
}))

import { POST } from './route'

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/scheduled-messages', { method: 'POST', body: JSON.stringify(body) }) as never)

const when = new Date(Date.now() + 3 * 86_400_000).toISOString()

describe('scheduling a message', () => {
  beforeEach(() => {
    h.created = null
  })

  it('takes plain text for a website chat, days ahead, with no template', async () => {
    h.channel = 'website'
    const res = await post({ conversation_id: 'c1', content_text: '  See you at the session on Monday  ', schedule_type: 'once', scheduled_at: when })
    expect(res.status).toBe(201)
    expect(h.created).toMatchObject({ content_text: 'See you at the session on Monday', template_name: null })
  })

  it('still asks for a message on a website chat', async () => {
    h.channel = 'website'
    const res = await post({ conversation_id: 'c1', content_text: '   ', schedule_type: 'once', scheduled_at: when })
    expect(res.status).toBe(400)
    expect(h.created).toBeNull()
  })

  it('still requires an approved template on WhatsApp', async () => {
    h.channel = 'whatsapp'
    const res = await post({ conversation_id: 'c1', content_text: 'hello', schedule_type: 'once', scheduled_at: when })
    expect(res.status).toBe(400)
    expect(h.created).toBeNull()
  })
})
