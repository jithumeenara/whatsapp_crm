import { describe, expect, it, vi } from 'vitest'

/**
 * An integration's credentials (an API key, a bearer token, a Basic-auth
 * password) went back to anybody who could read the integration — the
 * viewer rank included — in full. The screen only ever shows the key id.
 */

const row = {
  id: 'i1',
  account_id: 'acc',
  name: 'Razorpay',
  auth_type: 'basic',
  auth_config: { username: 'rzp_live_ABCDEFGHIJKLMNOP', password: 'super-secret-password' },
  syncs: [],
}

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'viewer', pageAccess: null }),
  assertPageAccess: () => {},
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    integration: {
      findFirst: () => Promise.resolve({ ...row }),
      findMany: () => Promise.resolve([{ ...row }, { ...row, id: 'i2', auth_type: 'api_key', auth_config: { header: 'X-Api-Key', value: 'k-123' } }]),
    },
  },
}))

import { GET as getOne } from './[id]/route'
import { GET as getAll } from './route'

describe('integration credentials are never sent back', () => {
  it('one integration: no password, the key id is still there', async () => {
    const res = await getOne(new Request('http://x/api/integrations/i1') as never, { params: Promise.resolve({ id: 'i1' }) })
    const text = await res.text()
    expect(text).not.toContain('super-secret-password')
    expect(JSON.parse(text).integration.auth_config.username).toBe('rzp_live_ABCDEFGHIJKLMNOP')
  })

  it('the list: no password, no API key value', async () => {
    const res = await getAll(new Request('http://x/api/integrations') as never)
    const text = await res.text()
    expect(text).not.toContain('super-secret-password')
    expect(text).not.toContain('k-123')
  })
})
