import { describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { message: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))

import { historyTurns, TEAM_MEMBER_MARKER } from './history'
import { cleanPolished, missingFacts } from './polish-message'
import { customerToolDeclarations } from './customer-tools'
import { staffAwaitingReply } from './auto-reply'

describe('a team member\'s messages in the assistant\'s history', () => {
  it('are marked as a colleague\'s, not the assistant\'s own', () => {
    const turns = historyTurns([
      { sender_type: 'agent', content_text: 'സാറിന്റെ ഡെസിഗ്നേഷൻ പറയാമോ' },
      { sender_type: 'customer', content_text: 'സീനിയർ ക്ലർക്ക്' },
    ])
    expect(turns[0]).toEqual({ role: 'model', text: `${TEAM_MEMBER_MARKER} സാറിന്റെ ഡെസിഗ്നേഷൻ പറയാമോ` })
    expect(turns[1]).toEqual({ role: 'user', text: 'സീനിയർ ക്ലർക്ക്' })
  })

  it('leave the assistant\'s own replies unmarked', () => {
    const turns = historyTurns([{ sender_type: 'bot', bot_source: 'ai_auto_reply', content_text: 'Hello' }])
    expect(turns[0].text).toBe('Hello')
  })
})

describe('waiting for the team member', () => {
  const now = new Date('2026-10-09T11:33:00+05:30')

  it('holds when the last thing said to the customer came from a person', async () => {
    findFirst.mockResolvedValueOnce({ sender_type: 'agent', created_at: new Date('2026-10-09T10:29:00+05:30') })
    expect(await staffAwaitingReply('c1', now)).not.toBeNull()
  })

  it('does not hold when the assistant spoke last', async () => {
    findFirst.mockResolvedValueOnce({ sender_type: 'bot', created_at: new Date('2026-10-09T10:29:00+05:30') })
    expect(await staffAwaitingReply('c1', now)).toBeNull()
  })

  it('does not hold for a team member\'s message from more than a day ago', async () => {
    findFirst.mockResolvedValueOnce({ sender_type: 'agent', created_at: new Date('2026-10-07T10:29:00+05:30') })
    expect(await staffAwaitingReply('c1', now)).toBeNull()
  })
})

describe('drafts change nothing', () => {
  const names = (noSideEffects: boolean) =>
    customerToolDeclarations({ accountId: 'a', contactId: 'c', conversationId: 'v', userId: 'u', noSideEffects }).map((d) => d.name)

  it('offers no tool that saves, schedules, records or starts anything', () => {
    const offered = names(true)
    for (const t of ['submit_registration', 'add_registration_details', 'schedule_callback', 'contact_handed_over', 'start_chatbot']) {
      expect(offered).not.toContain(t)
    }
    expect(offered).toContain('my_registrations')
  })

  it('leaves the live assistant\'s tools as they were', () => {
    expect(names(false)).toContain('submit_registration')
  })
})

describe('Improve keeps the facts', () => {
  it('finds a number, link or email the rewrite dropped', () => {
    const draft = 'Fee 7,080 rupees, pay at https://pay.example.com/x or write to training@acsti.in by 26.10.2026'
    expect(missingFacts(draft, 'Kindly pay the fee.')).toEqual(
      expect.arrayContaining(['7,080', 'https://pay.example.com/x', 'training@acsti.in', '26.10.2026']),
    )
  })

  it('accepts the same number written without its comma', () => {
    expect(missingFacts('Fee 7,080', 'The fee is ₹7080.')).toEqual([])
  })

  it('strips quotes and fences the model adds', () => {
    expect(cleanPolished('"Good morning, sir."')).toBe('Good morning, sir.')
    expect(cleanPolished('```\nNamaskaram sir\n```')).toBe('Namaskaram sir')
  })
})
