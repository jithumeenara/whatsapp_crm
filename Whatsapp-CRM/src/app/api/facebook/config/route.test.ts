import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug (security audit 2026-10, A4-03): the Facebook Page access token and
 * app secret were stored as plain text — anyone with a database backup
 * could post as every connected Page. They are now sealed with the same
 * AES-256-GCM as the WhatsApp tokens. And a Page already connected to
 * another workspace cannot be claimed (the webhook finds the workspace by
 * page_id, so a second claim could pull in another business's messages).
 */

const h = vi.hoisted(() => ({ writes: [] as unknown[][], takenBy: null as string | null }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'a1', userId: 'u1', role: 'owner' }) }
})
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('account_id <>')) return h.takenBy ? [{ n: 1 }] : []
      return []
    },
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      h.writes.push(values)
      return 1
    },
  },
}))

import { PATCH } from './route'
import { decrypt } from '@/lib/whatsapp/encryption'

const save = (body: Record<string, unknown>) =>
  new NextRequest('http://x/api/facebook/config', { method: 'PATCH', body: JSON.stringify(body) })

describe('Facebook settings — what is stored', () => {
  beforeEach(() => {
    h.writes = []
    h.takenBy = null
  })

  it('never stores the Page token or app secret as plain text', async () => {
    const res = await PATCH(save({ access_token: 'EAAGpagetoken123', app_secret: 'appsecret456', page_id: '1001', verify_token: 'v' }))
    expect(res.status).toBe(200)
    const values = h.writes.flat()
    expect(values).not.toContain('EAAGpagetoken123')
    expect(values).not.toContain('appsecret456')
    const sealed = values.filter((v): v is string => typeof v === 'string' && v.split(':').length === 3)
    expect(sealed.map((v) => decrypt(v)).sort()).toEqual(['EAAGpagetoken123', 'appsecret456'])
  })

  it("refuses a Page another workspace already connected", async () => {
    h.takenBy = 'a2'
    const res = await PATCH(save({ access_token: 'x', page_id: '1001' }))
    expect(res.status).toBe(409)
    expect(h.writes).toHaveLength(0)
  })
})
