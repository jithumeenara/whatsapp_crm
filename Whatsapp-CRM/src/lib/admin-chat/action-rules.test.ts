import { describe, expect, it } from 'vitest'
import { approvalRule, isUndoable, localDateTime, parseActionReply, UNDO_MINUTES } from './action-rules'

describe('replies to a proposed action', () => {
  it('YES with the 4-digit code, in any case and spacing', () => {
    expect(parseActionReply('YES 4821')).toEqual({ kind: 'yes', code: '4821' })
    expect(parseActionReply(' yes4821 ')).toEqual({ kind: 'yes', code: '4821' })
  })
  it('a bare YES is not enough — the code ties it to one action', () => {
    expect(parseActionReply('yes')).toBeNull()
    expect(parseActionReply('yes 12345')).toBeNull()
  })
  it('NO and UNDO', () => {
    expect(parseActionReply('no')).toEqual({ kind: 'no' })
    expect(parseActionReply('UNDO')).toEqual({ kind: 'undo' })
    expect(parseActionReply('no thanks, show leads')).toBeNull()
  })
})

describe('who must approve', () => {
  it('small actions: the chat confirmation is enough', () => {
    for (const k of ['add_follow_up', 'add_tag', 'assign_chat', 'create_lead'] as const) expect(approvalRule(k, null)).toBe('chat')
  })
  it('anything that reaches customers also needs the web, by the same person', () => {
    expect(approvalRule('send_template', null)).toBe('web_self')
    expect(approvalRule('prepare_broadcast', 50)).toBe('web_self')
  })
  it('a broadcast for more than 50 people needs a second admin', () => {
    expect(approvalRule('prepare_broadcast', 51)).toBe('web_other')
  })
})

describe('undo', () => {
  it('only what can be put back exactly', () => {
    expect(isUndoable('add_tag')).toBe(true)
    expect(isUndoable('assign_chat')).toBe(true)
    expect(isUndoable('add_follow_up')).toBe(true)
    expect(isUndoable('create_lead')).toBe(false)
    expect(isUndoable('send_template')).toBe(false)
    expect(UNDO_MINUTES).toBe(10)
  })
})

describe('a date and time the admin says, in the business zone', () => {
  it('"2026-10-21 10:30" in Kolkata is 05:00 UTC', () => {
    expect(localDateTime('2026-10-21 10:30', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-21T05:00:00.000Z')
    expect(localDateTime('2026-10-21T10:30', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-21T05:00:00.000Z')
  })
  it('a date alone is 10:00 that day', () => {
    expect(localDateTime('2026-10-21', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-21T04:30:00.000Z')
  })
  it('nonsense is refused', () => {
    expect(localDateTime('tomorrow', 'Asia/Kolkata')).toBeNull()
    expect(localDateTime('2026-13-40 10:00', 'Asia/Kolkata')).toBeNull()
    expect(localDateTime('2026-10-21 25:00', 'Asia/Kolkata')).toBeNull()
  })
})
