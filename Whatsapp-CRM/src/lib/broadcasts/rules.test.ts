import { describe, expect, it } from 'vitest'
import { followUpDue, frequencyCapReason, inSendWindow, isSendWindow, optOutIntent } from './rules'

const at = (h: number, m = 0) => h * 60 + m

describe('send window', () => {
  it('sends inside a daytime window and waits outside it', () => {
    expect(inSendWindow('09:00-21:00', at(9))).toBe(true)
    expect(inSendWindow('09:00-21:00', at(20, 59))).toBe(true)
    expect(inSendWindow('09:00-21:00', at(21))).toBe(false)
    expect(inSendWindow('09:00-21:00', at(3))).toBe(false)
  })
  it('handles a window across midnight', () => {
    expect(inSendWindow('21:00-06:00', at(23))).toBe(true)
    expect(inSendWindow('21:00-06:00', at(5))).toBe(true)
    expect(inSendWindow('21:00-06:00', at(12))).toBe(false)
  })
  it('no window means any time; a malformed one is refused at save', () => {
    expect(inSendWindow(null, at(3))).toBe(true)
    expect(isSendWindow('9-5')).toBe(false)
    expect(isSendWindow('24:00-09:00')).toBe(false)
    expect(isSendWindow('08:30-18:00')).toBe(true)
  })
})

describe('frequency cap', () => {
  const s = { frequency_cap_enabled: true, frequency_cap_count: 2, frequency_cap_days: 7 }
  it('holds back a third offer within the window', () => {
    expect(frequencyCapReason(1, true, s)).toBeNull()
    expect(frequencyCapReason(2, true, s)).toMatch(/2 offers in 7 days/)
  })
  it('never holds back a non-marketing message, or when switched off', () => {
    expect(frequencyCapReason(9, false, s)).toBeNull()
    expect(frequencyCapReason(9, true, { ...s, frequency_cap_enabled: false })).toBeNull()
  })
})

describe('STOP and START', () => {
  it('recognises a whole-message STOP in any case, with punctuation', () => {
    expect(optOutIntent('STOP')).toBe('stop')
    expect(optOutIntent('  Stop. ')).toBe('stop')
    expect(optOutIntent('unsubscribe!')).toBe('stop')
    expect(optOutIntent('നിർത്തുക')).toBe('stop')
    expect(optOutIntent('बंद करो')).toBe('stop')
  })
  it('does not opt out a sentence that merely contains the word', () => {
    expect(optOutIntent('please do not stop the class')).toBeNull()
    expect(optOutIntent('bus stop near the office?')).toBeNull()
    expect(optOutIntent('')).toBeNull()
  })
  it('recognises START to come back', () => {
    expect(optOutIntent('Start')).toBe('start')
    expect(optOutIntent('subscribe')).toBe('start')
  })
})

describe('automatic follow-up timing', () => {
  const now = new Date('2026-10-18T12:00:00Z')
  it('waits for the first broadcast to finish, then for the delay', () => {
    expect(followUpDue({ status: 'sending', finished_at: null }, 60, now)).toBe('wait')
    expect(followUpDue({ status: 'sent', finished_at: new Date('2026-10-18T11:30:00Z') }, 60, now)).toBe('wait')
    expect(followUpDue({ status: 'sent', finished_at: new Date('2026-10-18T11:00:00Z') }, 60, now)).toBe('send')
  })
  it('is called off when the first broadcast was cancelled or deleted', () => {
    expect(followUpDue({ status: 'cancelled', finished_at: null }, 60, now)).toBe('cancel')
    expect(followUpDue(null, 60, now)).toBe('cancel')
  })
})
