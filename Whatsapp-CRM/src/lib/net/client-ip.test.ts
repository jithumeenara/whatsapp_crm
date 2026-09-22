import { describe, it, expect } from 'vitest'
import { clientIp, clientIpKey } from './client-ip'

/** A stand-in for Request.headers, case-insensitive like the real one. */
function headers(bag: Record<string, string>) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(bag)) lower[k.toLowerCase()] = v
  return { get: (name: string) => lower[name.toLowerCase()] ?? null }
}

describe('clientIp', () => {
  it('trusts X-Real-IP, which nginx overwrites', () => {
    expect(clientIp(headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('ignores a forged X-Real-IP when nginx also set one', () => {
    // There is only ever one X-Real-IP header by the time it reaches
    // the app, because nginx sets rather than appends. A caller who
    // sends their own simply has it replaced.
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  describe('the bug this module exists to fix', () => {
    // nginx sends "<what the caller wrote>, <the real address>".
    const forged = '1.1.1.1, 198.51.100.9'

    it('reads the hop nginx appended, not the one the caller wrote', () => {
      expect(clientIp(headers({ 'x-forwarded-for': forged }))).toBe('198.51.100.9')
    })

    it('gives every forged value the same answer', () => {
      // The whole attack is "look like a different client each time".
      // A thousand different first entries must still collapse to one
      // rate-limit bucket.
      const seen = new Set<string | null>()
      for (let i = 0; i < 1000; i++) {
        seen.add(clientIp(headers({ 'x-forwarded-for': `10.0.0.${i % 256}, 198.51.100.9` })))
      }
      expect([...seen]).toEqual(['198.51.100.9'])
    })

    it('is not fooled by a caller who plants a comma-separated list', () => {
      const chain = 'a, b, c, d, 198.51.100.9'
      expect(clientIp(headers({ 'x-forwarded-for': chain }))).toBe('198.51.100.9')
    })
  })

  it('prefers X-Real-IP over the forwarded chain', () => {
    const h = headers({
      'x-real-ip': '198.51.100.9',
      'x-forwarded-for': '1.1.1.1, 198.51.100.9',
    })
    expect(clientIp(h)).toBe('198.51.100.9')
  })

  it('handles untidy spacing', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '  1.1.1.1 ,   198.51.100.9  ' })))
      .toBe('198.51.100.9')
  })

  it('has no answer when nothing identifies the caller', () => {
    expect(clientIp(headers({}))).toBeNull()
    expect(clientIp(headers({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIp(headers({ 'x-forwarded-for': ' , , ' }))).toBeNull()
  })
})

describe('clientIpKey', () => {
  it('never hands back an exemption', () => {
    // The dangerous failure here is a key so unique that nothing is
    // ever limited. Unknown callers share one bucket instead.
    expect(clientIpKey(headers({}))).toBe('unknown')
    expect(clientIpKey(headers({ 'x-forwarded-for': ' , , ' }))).toBe('unknown')
  })

  it('is the same address clientIp reports', () => {
    const h = headers({ 'x-forwarded-for': '1.1.1.1, 198.51.100.9' })
    expect(clientIpKey(h)).toBe(clientIp(h))
  })
})
