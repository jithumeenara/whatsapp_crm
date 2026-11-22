import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The Instagram and Messenger webhook handshake accepts the server's verify
 * token saved (sealed) in the database — no .env needed — compares it in
 * constant time and never logs the caller's guess.
 */

const h = vi.hoisted(() => ({ stored: 'sealed:the-db-token' as string | null }))

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => (strings.join('?').includes('meta_platform_config') ? [{ t: h.stored }] : []),
    $executeRaw: async () => 0,
  },
}))
vi.mock('@/lib/whatsapp/encryption', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/encryption')>('@/lib/whatsapp/encryption')
  return { ...actual, openStoredSecret: (v: string | null) => (v ? v.replace(/^sealed:/, '') : null) }
})
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))

import { GET as fbGET } from './route'
import { GET as igGET } from '../../instagram/webhook/route'

const req = (token: string) =>
  new NextRequest(`https://x/api/w?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=777`)

afterEach(() => { vi.restoreAllMocks(); h.stored = 'sealed:the-db-token' })

describe('webhook verify token from the database', () => {
  for (const [name, GET] of [['facebook', fbGET], ['instagram', igGET]] as const) {
    it(`${name}: the token saved in Settings answers the challenge`, async () => {
      const res = await GET(req('the-db-token'))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('777')
    })

    it(`${name}: a wrong token is refused and not logged`, async () => {
      const logged: string[] = []
      vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')))
      const res = await GET(req('guess-XYZ-secretish'))
      expect(res.status).toBe(403)
      expect(logged.join('\n')).not.toContain('guess-XYZ-secretish')
    })

    it(`${name}: no token saved — refused`, async () => {
      h.stored = null
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await GET(req('the-db-token'))).status).toBe(403)
    })
  }
})
