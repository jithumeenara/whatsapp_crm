import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanSignature, validScanSignature } from './scan-signature'

describe('the virus scanner callback', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts only the signature of that very file', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const id = '0dfeb152-aadb-4075-980c-804cd0f1fa01'
    expect(validScanSignature(id, scanSignature(id))).toBe(true)
    expect(validScanSignature('11111111-aadb-4075-980c-804cd0f1fa01', scanSignature(id))).toBe(false)
    expect(validScanSignature(id, null)).toBe(false)
    expect(validScanSignature(id, 'forged')).toBe(false)
  })

  it('accepts nothing when the server has no secret', () => {
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    expect(validScanSignature('x', 'anything')).toBe(false)
  })
})
