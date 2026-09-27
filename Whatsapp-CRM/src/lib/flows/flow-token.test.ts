import { describe, it, expect, beforeAll } from 'vitest'
import { mintFlowToken, phoneFromFlowToken } from './flow-token'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret-for-flow-tokens'
})

describe('flow tokens', () => {
  it('carries the recipient, and differs on every send', () => {
    const a = mintFlowToken('+91 98765 43210')
    const b = mintFlowToken('919876543210')
    expect(a).not.toBe(b)
    expect(phoneFromFlowToken(a)).toBe('919876543210')
    expect(phoneFromFlowToken(b)).toBe('919876543210')
  })

  it('cannot be edited to point at somebody else', () => {
    const token = mintFlowToken('919876543210')
    const forged = token.replace('919876543210', '919999999999')
    expect(phoneFromFlowToken(forged)).toBeNull()
  })

  it('reads nothing from other tokens', () => {
    expect(phoneFromFlowToken(crypto.randomUUID())).toBeNull()
    expect(phoneFromFlowToken('unused')).toBeNull()
    expect(phoneFromFlowToken('wct1.919876543210.abc')).toBeNull()
    expect(phoneFromFlowToken(null)).toBeNull()
  })

  it('falls back to a plain random token for a non-number', () => {
    const t = mintFlowToken('hello')
    expect(t.startsWith('wct1.')).toBe(false)
    expect(phoneFromFlowToken(t)).toBeNull()
  })
})
