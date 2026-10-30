import { describe, expect, it } from 'vitest'
import { isFacebookOrigin } from './facebook-origin'

describe('isFacebookOrigin', () => {
  it("accepts Meta's own pages", () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://web.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://facebook.com')).toBe(true)
  })

  it('refuses lookalikes that a bare endsWith("facebook.com") let through', () => {
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false)
    expect(isFacebookOrigin('http://www.facebook.com')).toBe(false)
    expect(isFacebookOrigin('https://facebook.com.evil.io')).toBe(false)
    expect(isFacebookOrigin('https://www.facebook.com:8443')).toBe(false)
    expect(isFacebookOrigin('null')).toBe(false)
  })
})
