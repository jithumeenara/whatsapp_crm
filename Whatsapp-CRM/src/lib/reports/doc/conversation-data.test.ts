import { describe, expect, it } from 'vitest'
import { summariseChats, REPLY_TARGET_MIN, type ChatRow } from './conversation-data'

const row = (o: Partial<ChatRow>): ChatRow => ({
  id: Math.random().toString(36).slice(2), channel: 'whatsapp', number: null, agent: null,
  day: '2026-11-10', hour: 10, replyMin: null, replyType: null, personMin: null, personBy: null, ageMin: 2000, ...o,
})

describe('summariseChats', () => {
  it('counts chats, first replies by who answered, and the share within the target', () => {
    const s = summariseChats([
      row({ replyMin: 1, replyType: 'bot', personMin: 30, personBy: 'u1' }),
      row({ replyMin: 10, replyType: 'agent', personMin: 10, personBy: 'u1' }),
      row({ replyMin: 120, replyType: 'agent', personMin: 120, personBy: 'u2' }),
      row({ replyMin: null }),
    ])
    expect(s.total).toBe(4)
    expect(s.answered).toBe(3)
    expect(s.byAi).toBe(1)
    expect(s.firstReplyMedian).toBe(10)
    expect(s.personReplyMedian).toBe(30)
    expect(s.withinTarget).toBe(2) // 1 and 10 minutes, target REPLY_TARGET_MIN
    expect(REPLY_TARGET_MIN).toBe(15)
  })

  it('a chat with no reply for 24 hours lost the free window; a fresh one is only waiting', () => {
    const s = summariseChats([row({ replyMin: null, ageMin: 1500 }), row({ replyMin: null, ageMin: 30 }), row({ replyMin: 1600, replyType: 'agent' })])
    expect(s.missedWindow).toBe(2) // never answered and 25 h old, or answered after 24 h
    expect(s.waiting).toBe(1)
  })

  it('groups by channel, number, hour and person, busiest first', () => {
    const s = summariseChats([
      row({ channel: 'instagram', hour: 9, personMin: 5, personBy: 'u1', replyMin: 5, replyType: 'agent' }),
      row({ channel: 'whatsapp', hour: 9 }),
      row({ channel: 'whatsapp', hour: 18 }),
    ])
    expect(s.byChannel.map((c) => [c.key, c.chats])).toEqual([['whatsapp', 2], ['instagram', 1]])
    expect(s.byHour[9].chats).toBe(2)
    expect(s.byPerson.get('u1')).toMatchObject({ answered: 1, median: 5 })
  })

  it('no chats: zeros and unknown medians, never NaN', () => {
    const s = summariseChats([])
    expect(s).toMatchObject({ total: 0, answered: 0, firstReplyMedian: null, personReplyMedian: null })
  })
})
