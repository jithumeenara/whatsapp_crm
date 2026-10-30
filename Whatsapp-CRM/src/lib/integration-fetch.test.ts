import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchExternalRows, redactIntegration } from './integration-fetch'

/**
 * An integration's Base URL is typed by a workspace admin — any person
 * who signs up is one — and the server fetched it as given, then sent
 * back the rows it parsed and the first 300 characters of any error
 * page. Pointed at the cloud metadata service or a port on the VPS's
 * private side, that was a way to read them.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchExternalRows refuses addresses inside the network', () => {
  for (const base of [
    'http://169.254.169.254/latest/meta-data',
    'http://127.0.0.1:5432',
    'http://localhost',
    'http://10.0.0.5',
    'http://[::1]',
    'http://2130706433', // 127.0.0.1, spelled as a number
    'file:///etc/passwd',
  ]) {
    it(`does not fetch ${base}`, async () => {
      const spy = vi.fn(async () => new Response(JSON.stringify([{ secret: 'AKIA-from-metadata' }]), { status: 200 }))
      vi.stubGlobal('fetch', spy)
      await expect(
        fetchExternalRows({ source_type: 'rest', base_url: base, resource: 'x', headers: {} }),
      ).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    })
  }
})

describe('redactIntegration', () => {
  it('keeps the key id and header name, drops every secret', () => {
    const out = redactIntegration({ id: 'i', auth_config: { username: 'rzp_1', password: 'p', token: 't', header: 'X-Key', value: 'v' } })
    expect(out.auth_config).toEqual({ username: 'rzp_1', header: 'X-Key', has_secret: true })
  })
  it('leaves an integration without credentials alone', () => {
    expect(redactIntegration({ id: 'i', auth_config: null }).auth_config).toBeNull()
  })
})
