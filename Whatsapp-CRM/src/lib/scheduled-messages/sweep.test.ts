import { describe, expect, it, vi } from 'vitest'

/**
 * Bug: the sweep runs every minute (and from the cron route). A pass that
 * took longer than a minute read the same unsent rows again and the
 * customer got the reminder twice. Two sweeps over one due row must send
 * it once.
 */

const h = vi.hoisted(() => ({
  sends: 0,
  row: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/email/conversation-send', () => ({ sendAndRecordConversationEmail: () => Promise.resolve() }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: async () => {
    h.sends++
    await new Promise((r) => setTimeout(r, 30)) // a slow send: the other sweep runs meanwhile
  },
  engineSendMedia: () => Promise.resolve(),
  engineSendInteractiveButtons: () => Promise.resolve(),
  engineSendTemplate: () => Promise.resolve(),
}))
vi.mock('@/lib/db', () => {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v instanceof Date ? (row[k] as Date).getTime() === v.getTime() : typeof v === 'object' && v !== null ? true : row[k] === v))
  return {
    prisma: {
      scheduledMessage: {
        // Each sweep reads the row as it is now (a copy, like a real query).
        findMany: async () => (h.row && h.row.status === 'active' ? [{ ...h.row }] : []),
        update: async (a: { data: Record<string, unknown> }) => {
          Object.assign(h.row!, a.data)
          return h.row
        },
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!h.row || !matches(h.row, a.where)) return { count: 0 }
          Object.assign(h.row, a.data)
          return { count: 1 }
        },
      },
      message: { findFirst: () => Promise.resolve(null) },
      contact: { findFirst: () => Promise.resolve(null) },
    },
  }
})

import { sweepScheduledMessages } from './sweep'

describe('scheduled message sweep', () => {
  it('two sweeps over the same due message send it once', async () => {
    h.sends = 0
    h.row = {
      id: 's1', account_id: 'a', conversation_id: 'c', contact_id: 'k', created_by: 'u',
      status: 'active', schedule_type: 'once', sends_count: 0, max_sends: 1,
      next_send_at: new Date(Date.now() - 1000), last_sent_at: null, stop_on_reply: false,
      error_count: 0, template_name: null, content_text: 'Reminder', buttons: null, media_url: null,
      interval_value: null, interval_unit: null,
    }
    await Promise.all([sweepScheduledMessages(), sweepScheduledMessages()])
    expect(h.sends).toBe(1)
    expect(h.row.status).toBe('completed')
  })
})
