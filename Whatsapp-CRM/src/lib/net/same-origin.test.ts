import { describe, expect, it } from 'vitest'
import { isCrossSiteWrite } from './same-origin'

/**
 * CSRF, second lock: a signed-in request that changes something must come
 * from this app's own pages; server-to-server calls are not affected.
 */
const base = { method: 'POST', origin: 'https://crm.example.com', secFetchSite: 'same-origin', requestHost: 'crm.example.com', appUrl: 'https://crm.example.com' }

describe('isCrossSiteWrite', () => {
  it('our own page saving something is allowed', () => {
    expect(isCrossSiteWrite(base)).toBe(false)
  })

  it('another site posting with the person’s browser is refused', () => {
    expect(isCrossSiteWrite({ ...base, origin: 'https://evil.example', secFetchSite: 'cross-site' })).toBe(true)
    expect(isCrossSiteWrite({ ...base, origin: 'https://evil.example', secFetchSite: null })).toBe(true)
    expect(isCrossSiteWrite({ ...base, origin: 'null', secFetchSite: null })).toBe(true)
    expect(isCrossSiteWrite({ ...base, method: 'DELETE', origin: 'https://crm.example.com.evil.example', secFetchSite: null })).toBe(true)
  })

  it('reads are never blocked', () => {
    expect(isCrossSiteWrite({ ...base, method: 'GET', origin: 'https://evil.example', secFetchSite: 'cross-site' })).toBe(false)
  })

  it('a server or curl (no Origin, no Sec-Fetch-Site) is not a browser and passes', () => {
    expect(isCrossSiteWrite({ ...base, origin: null, secFetchSite: null })).toBe(false)
  })

  it('behind nginx (Host = localhost:3000) a modern browser saving from our own page is allowed', () => {
    expect(isCrossSiteWrite({ ...base, origin: 'https://crm.example.com', secFetchSite: 'same-origin', requestHost: 'localhost:3000', appUrl: null })).toBe(false)
  })

  it('older browser without Sec-Fetch-Site falls back to Origin vs host / app URL', () => {
    expect(isCrossSiteWrite({ ...base, secFetchSite: null, requestHost: 'localhost:3000' })).toBe(false)
    expect(isCrossSiteWrite({ ...base, secFetchSite: null, origin: 'https://evil.example', requestHost: 'localhost:3000' })).toBe(true)
  })

  it('www and the bare domain of the app URL are the same app', () => {
    expect(isCrossSiteWrite({ ...base, secFetchSite: null, origin: 'https://www.acme.in', requestHost: 'localhost:3000', appUrl: 'https://acme.in' })).toBe(false)
  })
})
