import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An integration's credentials (an API key, a bearer token, the Razorpay
 * key secret) were written to integrations.auth_config as plain JSON, so
 * anyone holding a database dump or backup had them. Every other stored
 * secret is sealed with ENCRYPTION_KEY; these must be too — and rows saved
 * before this change must keep working without a data migration.
 */

const writes: Array<Record<string, unknown>> = []
let stored: Record<string, unknown> | null = null

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'admin', pageAccess: null }),
  assertPageAccess: () => {},
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    integration: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data)
        return Promise.resolve({ id: 'i1', ...data })
      },
      findFirst: () => Promise.resolve(stored),
      update: ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data)
        return Promise.resolve({ ...stored, ...data })
      },
    },
  },
}))

import { POST } from './route'
import { PATCH } from './[id]/route'
import { openAuthConfig } from '@/lib/integration-secrets'

const post = (body: unknown) =>
  POST(new Request('http://x/api/integrations', { method: 'POST', body: JSON.stringify(body) }) as never)
const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/integrations/i1', { method: 'PATCH', body: JSON.stringify(body) }) as never, {
    params: Promise.resolve({ id: 'i1' }),
  })

beforeEach(() => {
  writes.length = 0
  stored = null
})

describe('integration credentials are encrypted at rest', () => {
  it('a new integration is saved without its secret in clear text', async () => {
    await post({
      name: 'Razorpay', base_url: 'https://api.razorpay.com', resource: 'payments', auth_type: 'basic',
      auth_config: { username: 'rzp_test_KEYID', password: 'plain-key-secret' },
    })
    const saved = JSON.stringify(writes[0].auth_config)
    expect(saved).not.toContain('plain-key-secret')
    expect(openAuthConfig(writes[0].auth_config)).toEqual({ username: 'rzp_test_KEYID', password: 'plain-key-secret' })
  })

  it('editing the credentials seals the new ones', async () => {
    stored = { id: 'i1', account_id: 'acc', name: 'X', auth_type: 'bearer', auth_config: null }
    await patch({ auth_config: { token: 'new-bearer-token' } })
    expect(JSON.stringify(writes[0].auth_config)).not.toContain('new-bearer-token')
    expect(openAuthConfig(writes[0].auth_config)).toEqual({ token: 'new-bearer-token' })
  })

  it('a redacted copy sent back by a client never replaces the real secret', async () => {
    stored = { id: 'i1', account_id: 'acc', name: 'X', auth_type: 'basic', auth_config: { username: 'u', password: 'keep-me' } }
    await patch({ name: 'Renamed', auth_config: { username: 'u', has_secret: true } })
    expect(openAuthConfig(writes[0].auth_config)).toEqual({ username: 'u', password: 'keep-me' })
  })

  it('rows saved before encryption still read as they are', () => {
    expect(openAuthConfig({ header: 'X-Api-Key', value: 'legacy' })).toEqual({ header: 'X-Api-Key', value: 'legacy' })
    expect(openAuthConfig(null)).toBeNull()
  })
})
