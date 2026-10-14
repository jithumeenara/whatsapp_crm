import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'
import { strictCsp } from './csp'

// Bug: a voice message recorded in the Inbox would not play in the
// preview, and its waveform stayed flat. The recording is a local
// blob: URL, and the site's Content-Security-Policy had no media-src,
// so default-src 'self' applied and the browser refused to load blob:
// audio. (The test page used while building it had no CSP, so it played
// there.) Both the enforcing policy and the report-only one must allow it.

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
}

async function enforcingPolicies(): Promise<string[]> {
  const rules = (await nextConfig.headers?.()) ?? []
  return rules
    .flatMap((r) => r.headers)
    .filter((h) => h.key.toLowerCase() === 'content-security-policy')
    .map((h) => h.value)
}

describe('recorded audio may play under the site policy', () => {
  it('the enforcing policy allows blob: media', async () => {
    const policies = await enforcingPolicies()
    expect(policies.length).toBeGreaterThan(0)
    for (const p of policies) {
      expect(directive(p, 'media-src') ?? '').toContain('blob:')
    }
  })

  it('the report-only policy allows blob: media too', () => {
    expect(directive(strictCsp('N'), 'media-src') ?? '').toContain('blob:')
  })
})
