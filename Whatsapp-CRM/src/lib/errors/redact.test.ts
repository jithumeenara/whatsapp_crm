import { describe, expect, it } from 'vitest'
import { normaliseForFingerprint, redactSecrets } from './redact'

/** Errors are stored and shown to admins: no token, password or personal number may survive. */
describe('redactSecrets', () => {
  it('removes tokens from URLs, headers and JSON', () => {
    const t = redactSecrets('GET https://graph.facebook.com/v24.0/me?fields=id&access_token=EAAB123abcdefghijklmnopqrstuvwxyz failed; Authorization: Bearer abcdefghijkl12345 {"password":"hunter2","otp":"123456"}')
    expect(t).not.toMatch(/EAAB123|abcdefghijkl12345|hunter2|123456/)
    expect(t).toContain('access_token=[redacted]')
    expect(t).toContain('Bearer [redacted]')
  })

  it('removes API keys, bot tokens, JWTs, emails and long numbers', () => {
    const t = redactSecrets('key AIzaSyA1234567890abcdefghijklmnopqrstu rzp_live_ABCdef123456 /bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw anu@Example.com +919876543210 1234 5678 9012')
    expect(t).not.toMatch(/AIzaSy|rzp_live_ABC|AAHdqTcv|anu@|9876543210|5678 9012/)
  })

  it('leaves an ordinary message readable', () => {
    expect(redactSecrets('[auto-reply] handoff failed: connection reset')).toBe('[auto-reply] handoff failed: connection reset')
  })
})

describe('normaliseForFingerprint', () => {
  it('the same error about different records is one error', () => {
    const a = normaliseForFingerprint('Conversation 8f3c2a1e-1111-4222-8333-944455556666 not found after 3 tries')
    const b = normaliseForFingerprint('Conversation 0a0b0c0d-1111-4222-8333-944455556666 not found after 7 tries')
    expect(a).toBe(b)
  })

  it('the same error about different WhatsApp messages is one error', () => {
    const a = normaliseForFingerprint('[cost] wamid.HBgMOTE5NDQ3MzEwMjQ0FQIAERgSNzdEMzIxRjBEOTY4Njc2OUQ2AA==: not saved yet')
    const b = normaliseForFingerprint('[cost] wamid.HBgMOTE5NDk3ODU4NzM1FQIAERgSMEM3OUFCQzc5OENGNzQxRUNCAA==: not saved yet')
    expect(a).toBe(b)
  })

  it('ordinary words are not mistaken for ids', () => {
    expect(normaliseForFingerprint('Google refused the saved sign-in. Connect Google again.')).toBe('Google refused the saved sign-in. Connect Google again.')
  })
})
