import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { issueRealtimeTicket, verifyRealtimeTicket } from './realtime-ticket'
import { issueLiveVoiceTicket, verifyLiveVoiceTicket } from './ai/live-voice-ticket'

describe('realtime tickets', () => {
  const saved = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'test-secret'
  })
  afterAll(() => {
    process.env.NEXTAUTH_SECRET = saved
    vi.useRealTimers()
  })

  it('names the account it was issued for', () => {
    const ticket = issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' })
    expect(verifyRealtimeTicket(ticket)?.accountId).toBe('acc-1')
  })

  it('refuses a ticket whose account was edited', () => {
    const ticket = issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' })
    const [body, sig] = ticket.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    payload.accountId = 'acc-2'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyRealtimeTicket(forged)).toBeNull()
  })

  it('refuses nothing, junk and an expired ticket', () => {
    expect(verifyRealtimeTicket(undefined)).toBeNull()
    expect(verifyRealtimeTicket('acc-1')).toBeNull()
    expect(verifyRealtimeTicket('x'.repeat(5000))).toBeNull()
    vi.useFakeTimers()
    const ticket = issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' })
    vi.advanceTimersByTime(61_000)
    expect(verifyRealtimeTicket(ticket)).toBeNull()
    vi.useRealTimers()
  })

  it('cannot be swapped with a live-voice ticket, either way', () => {
    const realtime = issueRealtimeTicket({ accountId: 'acc-1', userId: 'u-1' })
    expect(verifyLiveVoiceTicket(realtime)).toBeNull()
    const voice = issueLiveVoiceTicket({ accountId: 'acc-1', userId: 'u-1', mode: 'admin' })
    expect(verifyRealtimeTicket(voice)).toBeNull()
  })
})
