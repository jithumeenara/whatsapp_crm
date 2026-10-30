import { describe, expect, it } from 'vitest'
import { encrypt, isSealed, openStoredSecret, sealSecret } from './encryption'

describe('stored secrets — sealed on write, old plain rows still read', () => {
  it('round-trips', () => {
    const sealed = sealSecret('EAAGtoken')!
    expect(sealed).not.toContain('EAAGtoken')
    expect(isSealed(sealed)).toBe(true)
    expect(openStoredSecret(sealed)).toBe('EAAGtoken')
  })
  it('reads an old plain-text row as it is', () => {
    expect(openStoredSecret('EAAGplain')).toBe('EAAGplain')
    expect(openStoredSecret('a'.repeat(64))).toBe('a'.repeat(64))
    expect(openStoredSecret(null)).toBeNull()
  })
  it('never double-seals', () => {
    const once = encrypt('x')
    expect(sealSecret(once)).toBe(once)
    expect(sealSecret('')).toBeNull()
  })
  it('a tampered sealed value fails loudly rather than being used as a token', () => {
    const s = encrypt('token')
    const bad = s.slice(0, -2) + (s.endsWith('00') ? '11' : '00')
    expect(() => openStoredSecret(bad)).toThrow()
  })
})
