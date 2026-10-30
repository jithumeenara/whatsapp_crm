import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug (security audit 2026-10, A6-06): the Facebook and Instagram webhook
 * GET handshake compared the env verify token with `===` and wrote the
 * caller's guess into the log verbatim. Both now compare in constant time
 * and log no token.
 */

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: async () => [], $executeRaw: async () => 0 } }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))

import { GET as fbGET } from './route'
import { GET as igGET } from '../../instagram/webhook/route'

const req = (token: string) =>
  new NextRequest(`https://x/api/w?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=12345`)

describe('Facebook / Instagram webhook verify handshake', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  for (const [name, GET, envName] of [
    ['facebook', fbGET, 'FACEBOOK_VERIFY_TOKEN'],
    ['instagram', igGET, 'INSTAGRAM_VERIFY_TOKEN'],
  ] as const) {
    it(`${name}: never writes the caller's token to the log`, async () => {
      vi.stubEnv(envName, 'the-real-token')
      const logged: string[] = []
      vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')))
      vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')))
      const res = await GET(req('attacker-guess-SECRETISH'))
      expect(res.status).toBe(403)
      expect(logged.join('\n')).not.toContain('attacker-guess-SECRETISH')
    })

    it(`${name}: the right env token still answers the challenge`, async () => {
      vi.stubEnv(envName, 'the-real-token')
      const res = await GET(req('the-real-token'))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('12345')
    })
  }
})
