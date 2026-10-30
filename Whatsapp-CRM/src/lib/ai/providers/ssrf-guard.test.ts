import { describe, it, expect } from 'vitest'
import { assertSafeAiBaseUrl, portsFor } from './ssrf-guard'

// Security audit A9-02: the fast pre-check in front of the central
// safeFetch, for the custom AI base_url and knowledge-base websites.
describe('assertSafeAiBaseUrl — literal hosts', () => {
  it.each([
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://100.64.0.1/',
    'http://169.254.169.254/',
    'http://127.0.0.1:3000/',
    'http://2130706433/',
    'http://localhost./',
  ])('refuses %s', (url) => {
    expect(() => assertSafeAiBaseUrl(url)).toThrow()
  })

  it.each(['https://api.openai.com/v1', 'https://example.com/page', 'http://[2606:4700::1111]/'])(
    'allows %s',
    (url) => {
      expect(() => assertSafeAiBaseUrl(url)).not.toThrow()
    },
  )

  it('refuses non-http schemes', () => {
    expect(() => assertSafeAiBaseUrl('file:///etc/passwd')).toThrow()
  })
})

describe('portsFor', () => {
  it('adds the URL’s own port to 80 and 443', () => {
    expect(portsFor('https://llm.example:8000/v1')).toEqual([80, 443, 8000])
    expect(portsFor('https://llm.example/v1')).toEqual([80, 443])
  })
})
