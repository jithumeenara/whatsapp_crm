import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Message search reads every chat's text, so it must keep the Inbox's own
 * limits: this account only, and an agent's own conversations only.
 */

const ACC = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  role: 'admin',
  queries: [] as Array<{ text: string; values: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  fail: null as Error | null,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async (s: { strings?: readonly string[]; sql?: string; values?: unknown[] }, ...values: unknown[]) => {
      h.queries.push({ text: Array.from(s as unknown as string[]).join('?'), values })
      if (h.fail) throw h.fail
      return h.rows
    },
  }
  return {
    ...actual,
    requireRole: async () => ({
      accountId: ACC,
      userId: USER,
      role: h.role,
      db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
    }),
  }
})

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/conversations/search?${qs}`))

/** The whole query with nested Prisma.sql fragments flattened. */
function flat(): { text: string; values: unknown[] } {
  const q = h.queries[0]
  const values: unknown[] = []
  const text = q.values
    .map((v) => {
      const frag = v as { strings?: string[]; values?: unknown[] }
      if (frag && Array.isArray(frag.strings)) {
        values.push(...(frag.values ?? []))
        return frag.strings.join('?')
      }
      values.push(v)
      return '?'
    })
    .join(' ')
  return { text: `${q.text} ${text}`, values }
}

describe('GET /api/conversations/search', () => {
  beforeEach(() => {
    h.role = 'admin'
    h.queries = []
    h.rows = []
    h.fail = null
  })

  it('refuses a query that is too short or too long, without touching the database', async () => {
    expect((await get('q=a')).status).toBe(400)
    expect((await get(`q=${'a'.repeat(101)}`)).status).toBe(400)
    expect(h.queries).toHaveLength(0)
  })

  it('searches only this account, and leaves out removed messages and archived contacts', async () => {
    await get('q=fee')
    const { text, values } = flat()
    expect(values).toContain(ACC)
    expect(text).toContain('c.account_id')
    expect(text).toContain('m.deleted_at IS NULL')
    expect(text).toContain('ct.archived_at IS NULL')
    expect(values).toContain('%fee%')
  })

  it("limits an agent to their own conversations, and nobody else", async () => {
    h.role = 'agent'
    await get('q=fee')
    expect(flat().text).toContain('c.assigned_agent_id')
    expect(flat().values).toContain(USER)
    h.queries = []
    h.role = 'admin'
    await get('q=fee')
    expect(flat().text).not.toContain('c.assigned_agent_id')
  })

  it('ignores a filter value that is not a plain word', async () => {
    await get(`q=fee&status=${encodeURIComponent("open' OR 1=1")}&channel=telegram`)
    const { text, values } = flat()
    expect(text).not.toContain('c.status =')
    expect(values).not.toContain("open' OR 1=1")
    expect(values).toContain('telegram')
  })

  it('returns a short snippet, never the whole message, and says when there are more', async () => {
    const long = `${'x '.repeat(200)}fee ${'y '.repeat(200)}`
    h.rows = Array.from({ length: 31 }, (_, i) => ({ id: `m${i}`, conversation_id: 'c1', sender_type: 'customer', content_text: long, created_at: new Date(), status: 'open', channel: 'whatsapp', contact_name: 'A', contact_phone: '1' }))
    const body = await (await get('q=fee')).json()
    expect(body.results).toHaveLength(30)
    expect(body.more).toBe(true)
    expect(body.results[0].snippet.length).toBeLessThan(150)
    expect(body.results[0].content_text).toBeUndefined()
  })

  it('gives a plain message when the search times out', async () => {
    h.fail = Object.assign(new Error('canceling statement due to statement timeout'), { meta: { code: '57014' } })
    const res = await get('q=fee')
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/too long/)
  })
})
