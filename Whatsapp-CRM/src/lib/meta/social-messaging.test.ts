import { describe, expect, it } from 'vitest'
import { explainMetaError, graphHost, isFacebookToken, messagesUrl, recipientIdFor, windowDecision } from './social-messaging'

/**
 * Bugs this covers:
 *  - Every Instagram send went to graph.instagram.com, so an EAA token
 *    (Embedded Signup Page token, System User token, Unified Login token)
 *    could never send a reply.
 *  - Messenger had no send address for bot/AI/automation replies at all.
 *  - Sends used contact.phone; a real phone number must never go to Meta
 *    as a user id.
 */

describe('which Meta address a message goes to', () => {
  it('an Instagram Login token uses graph.instagram.com /me', () => {
    expect(messagesUrl({ channel: 'instagram', token: 'IGAAabc', igAccountId: '17841400000000' }))
      .toBe('https://graph.instagram.com/v27.0/me/messages')
  })
  it('an EAA token on Instagram uses graph.facebook.com with the Instagram account id', () => {
    expect(messagesUrl({ channel: 'instagram', token: 'EAAxyz', igAccountId: '17841400000000', pageId: '1029' }))
      .toBe('https://graph.facebook.com/v27.0/17841400000000/messages')
  })
  it('an EAA token with only a Page id uses the Page', () => {
    expect(messagesUrl({ channel: 'instagram', token: 'EAAxyz', pageId: '1029' })).toBe('https://graph.facebook.com/v27.0/1029/messages')
  })
  it('Messenger uses graph.facebook.com with the Page id', () => {
    expect(messagesUrl({ channel: 'facebook', token: 'EAAxyz', pageId: '1029' })).toBe('https://graph.facebook.com/v27.0/1029/messages')
  })
  it('a stored id that is not a number can never change the path', () => {
    expect(messagesUrl({ channel: 'facebook', token: 'EAAx', pageId: '1029/../../me/accounts' })).toBe('https://graph.facebook.com/v27.0/me/messages')
    expect(messagesUrl({ channel: 'instagram', token: 'EAAx', igAccountId: '1?x=1' })).toBe('https://graph.facebook.com/v27.0/me/messages')
  })
  it('token family and read host', () => {
    expect(isFacebookToken('  EAAB')).toBe(true)
    expect(isFacebookToken('IGQWR')).toBe(false)
    expect(graphHost('instagram', 'IGAA1')).toBe('https://graph.instagram.com/v27.0')
    expect(graphHost('instagram', 'EAA1')).toBe('https://graph.facebook.com/v27.0')
    expect(graphHost('facebook', 'EAA1')).toBe('https://graph.facebook.com/v27.0')
  })
})

describe('who receives it', () => {
  it('the platform id kept on the contact', () => {
    expect(recipientIdFor('instagram', { instagram_id: '111', phone: '+919847012345' })).toBe('111')
    expect(recipientIdFor('facebook', { facebook_id: '222', instagram_id: '111' })).toBe('222')
  })
  it('older Instagram contacts: a numeric phone holds the IGSID', () => {
    expect(recipientIdFor('instagram', { instagram_id: null, phone: '17841400000000' })).toBe('17841400000000')
  })
  it('a real phone number is never sent to Meta as a user id', () => {
    expect(recipientIdFor('facebook', { facebook_id: null, phone: '+919847012345' })).toBeNull()
    expect(recipientIdFor('instagram', { instagram_id: '', phone: 'not-a-number' })).toBeNull()
  })
})

describe("Meta's reply window", () => {
  const now = new Date('2026-11-16T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
  it('within 24 hours: allowed, no tag', () => {
    expect(windowDecision(hoursAgo(23), now, false)).toEqual({ ok: true, tag: null })
  })
  it('after 24 hours: refused, unless Human Agent is on (then up to 7 days with the tag)', () => {
    expect(windowDecision(hoursAgo(30), now, false).ok).toBe(false)
    expect(windowDecision(hoursAgo(30), now, true)).toEqual({ ok: true, tag: 'HUMAN_AGENT' })
    expect(windowDecision(hoursAgo(24 * 8), now, true).ok).toBe(false)
  })
  it('never written: refused', () => {
    expect(windowDecision(null, now, true).ok).toBe(false)
  })
})

describe("Meta's errors in plain words", () => {
  it('expired token, blocked messages, window, Business AI, rate limit', () => {
    expect(explainMetaError({ code: 190 }, 400)).toMatch(/Reconnect/)
    expect(explainMetaError({ code: 200, message: 'The account owner has disabled access to Instagram Direct Messaging Outside of Instagram App.' }, 400)).toMatch(/Allow access to messages/)
    expect(explainMetaError({ code: 10, error_subcode: 2018278 }, 400)).toMatch(/window/)
    expect(explainMetaError({ code: 10, error_subcode: 2018300 }, 400)).toMatch(/Business AI/)
    expect(explainMetaError({ code: 613 }, 400)).toMatch(/limiting/)
    expect(explainMetaError(undefined, 500)).toBe('Meta refused the message (500).')
  })
})
