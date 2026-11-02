import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The audit log is read by admins and owners of that account only
 * (plan §6, §9): supervisors, agents, viewers and API keys are refused;
 * another account's event is the same 404 as a missing one; exports are
 * capped per account and formula-safe; unknown filters are refused.
 */

const ACC = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  role: 'admin' as string | null,
  platformOwner: false,
  exportsLastHour: 0,
  events: [] as Array<Record<string, unknown>>,
  audited: [] as Array<{ action: string; meta?: unknown }>,
  apiKeyCalls: 0,
  txFails: false,
  locks: [] as string[],
}))

vi.mock('@/lib/auth/account', () => {
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  class UnauthorizedError extends Error { readonly status = 401 as const }
  class ForbiddenError extends Error { readonly status = 403 as const }
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: async (min: string) => {
      if (!h.role) throw new UnauthorizedError('Unauthorized')
      if (rank[h.role] < rank[min]) throw new ForbiddenError('Forbidden')
      return { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: ACC, role: h.role }
    },
    requireRoleOrApiKey: async () => {
      h.apiKeyCalls++
      return { userId: 'u', accountId: ACC, role: 'admin', apiKeyId: 'k' }
    },
    toErrorResponse: (e: { status?: number; message?: string }) =>
      new Response(JSON.stringify({ error: e.message ?? 'error' }), { status: e.status ?? 500 }),
  }
})

function matches(e: Record<string, unknown>, where: Record<string, unknown>): boolean {
  const and = (where.AND as Array<Record<string, unknown>> | undefined) ?? [where]
  return and.every((w) => {
    if (w.AND) return matches(e, w)
    if ('account_id' in w && e.account_id !== w.account_id) return false
    if ('id' in w && typeof w.id === 'bigint' && e.id !== w.id) return false
    return true
  })
}

vi.mock('@/lib/db', () => {
  const prisma = {
    auditEvent: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.action === 'access.audit_viewed') return { id: BigInt(1) }
        return h.events.find((e) => matches(e, where)) ?? null
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const and = (where.AND as Array<Record<string, unknown>>) ?? []
        const hasCursor = JSON.stringify(and, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes('"id":{"lt"')
        if (hasCursor) return []
        return h.events.filter((e) => matches(e, where)).slice(0, take ?? 1000)
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        where.action === 'access.audit_exported' ? h.exportsLastHour : h.events.filter((e) => matches(e, where)).length,
    },
    auditChainHead: { findUnique: async () => ({ last_seq: BigInt(9), last_hash: 'f'.repeat(64), updated_at: new Date() }) },
    auditCheckpoint: { findFirst: async () => null },
    profile: { findMany: async () => [] },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) h.locks.push(String(values[0]))
      return [{ events: 0, failed_logins: 0, denied: 0, config_changes: 0, exports: 0 }]
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (h.txFails) throw new Error('could not serialize access')
      return fn(prisma)
    },
  }
  return { prisma }
})

vi.mock('@/lib/audit/write', () => ({
  PLATFORM_ACCOUNT: '00000000-0000-0000-0000-000000000000',
  audit: async (_ctx: unknown, e: { action: string; meta?: unknown }) => {
    h.audited.push(e)
  },
  auditInTx: async (_tx: unknown, _ctx: unknown, e: { action: string; meta?: unknown }) => {
    h.audited.push(e)
  },
}))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: async () => h.platformOwner }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/audit/verify', () => ({
  verifyAccountChain: async () => ({ ok: true, rows: 3, lastSeq: '3', lastHash: 'x' }),
}))

import { GET as listEvents } from './events/route'
import { GET as oneEvent } from './events/[id]/route'
import { POST as exportLog } from './export/route'
import { POST as verifyLog } from './verify/route'
import { GET as summary } from './summary/route'

function event(id: number, accountId: string, extra: Record<string, unknown> = {}) {
  return {
    id: BigInt(id), seq: BigInt(id), account_id: accountId, occurred_at: new Date(),
    actor_type: 'user', actor_id: null, actor_label: null, actor_role: 'admin', on_behalf_of: null,
    action: 'record.updated', category: 'data', outcome: 'success', reason: null,
    target_type: 'lead', target_id: '7', target_label: 'Anu', changes: null,
    request_id: null, correlation_id: null, source: 'web', ip: null, user_agent: null, meta: null,
    row_hash: 'a'.repeat(64), ...extra,
  }
}

const base = 'https://crm.example/api/audit'
const get = (path: string, init?: RequestInit) => new Request(`${base}${path}`, init)
const post = (path: string, body: unknown) =>
  new Request(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('audit API', () => {
beforeEach(() => {
  h.role = 'admin'
  h.platformOwner = false
  h.exportsLastHour = 0
  h.events = [event(1, ACC), event(2, OTHER)]
  h.audited = []
  h.apiKeyCalls = 0
  h.txFails = false
  h.locks = []
})

describe('who may read the audit log', () => {
  for (const role of ['supervisor', 'agent', 'viewer']) {
    it(`refuses a ${role} on every endpoint`, async () => {
      h.role = role
      expect((await listEvents(get('/events'))).status).toBe(403)
      expect((await oneEvent(get('/events/1'), params('1'))).status).toBe(403)
      expect((await summary(get('/summary'))).status).toBe(403)
      expect((await exportLog(post('/export', { format: 'csv' }))).status).toBe(403)
      expect((await verifyLog(post('/verify', {}))).status).toBe(403)
    })
  }

  it('lets an admin read but only an owner verify', async () => {
    expect((await listEvents(get('/events'))).status).toBe(200)
    expect((await verifyLog(post('/verify', {}))).status).toBe(403)
    h.role = 'owner'
    const r = await verifyLog(post('/verify', {}))
    expect(r.status).toBe(200)
    expect(h.audited.map((a) => a.action)).toContain('access.audit_verified')
  })

  it('never accepts an API key: no session means no access, and no route asks for a key', async () => {
    h.role = null
    const withKey = { headers: { authorization: 'Bearer crm_live_secret' } }
    expect([401, 403]).toContain((await listEvents(get('/events', withKey))).status)
    expect([401, 403]).toContain((await oneEvent(get('/events/1', withKey), params('1'))).status)
    expect([401, 403]).toContain((await summary(get('/summary', withKey))).status)
    expect(h.apiKeyCalls).toBe(0)
    for (const f of ['events/route.ts', 'events/[id]/route.ts', 'export/route.ts', 'verify/route.ts', 'summary/route.ts']) {
      expect(readFileSync(join(__dirname, f), 'utf8')).not.toMatch(/requireRoleOrApiKey\s*\(|verifyApiKey\s*\(|import[^\n]*(requireRoleOrApiKey|verifyApiKey)/)
    }
  })

  it('refuses the platform chain to anyone but the server owner', async () => {
    h.role = 'owner'
    expect((await listEvents(get('/events?scope=platform'))).status).toBe(403)
    h.platformOwner = true
    expect((await listEvents(get('/events?scope=platform'))).status).toBe(200)
  })
})

describe('one event', () => {
  it("returns another account's event as the same 404 as a missing one", async () => {
    const theirs = await oneEvent(get('/events/2'), params('2'))
    const missing = await oneEvent(get('/events/999'), params('999'))
    expect(theirs.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await theirs.json()).toEqual(await missing.json())
  })

  it('returns its own event with ids as strings', async () => {
    const r = await oneEvent(get('/events/1'), params('1'))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.event).toEqual(expect.objectContaining({ id: '1', seq: '1', target_label: 'Anu' }))
  })

  it('treats a non-numeric id as not found', async () => {
    expect((await oneEvent(get('/events/1%20OR%201=1'), params('1 OR 1=1'))).status).toBe(404)
  })
})

describe('filters', () => {
  it('refuses an unknown category', async () => {
    expect((await listEvents(get('/events?category=secrets'))).status).toBe(400)
  })
  it('refuses an unknown parameter (column)', async () => {
    expect((await listEvents(get('/events?sort=row_hash'))).status).toBe(400)
    expect((await listEvents(get('/events?account_id=' + OTHER))).status).toBe(400)
  })
  it('refuses an unknown action, outcome or who', async () => {
    expect((await listEvents(get('/events?action=record.dropped'))).status).toBe(400)
    expect((await listEvents(get('/events?outcome=maybe'))).status).toBe(400)
    expect((await listEvents(get('/events?actor=everyone'))).status).toBe(400)
  })
  it('refuses a date without its zone, and text search over more than 92 days', async () => {
    expect((await listEvents(get('/events?from=2026-11-01'))).status).toBe(400)
    const from = encodeURIComponent('2026-01-01T00:00:00+05:30')
    const to = encodeURIComponent('2026-11-01T00:00:00+05:30')
    expect((await listEvents(get(`/events?from=${from}&to=${to}&q=anu`))).status).toBe(400)
  })
  it('only ever lists the caller\'s own account', async () => {
    const body = await (await listEvents(get('/events'))).json()
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(['1'])
  })
})

describe('export', () => {
  it('stops at three exports an hour for the account', async () => {
    h.exportsLastHour = 3
    const r = await exportLog(post('/export', { format: 'csv' }))
    expect(r.status).toBe(429)
    expect(h.audited).toHaveLength(0)
  })

  it('neutralises a formula in a cell and records the export', async () => {
    h.events = [event(1, ACC, { target_label: '=HYPERLINK("http://evil","x")' })]
    const r = await exportLog(post('/export', { format: 'csv' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const text = await r.text()
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(text).not.toMatch(/(^|,)"=HYPERLINK/m)
    expect(text).toContain('through_seq=9')
    const rec = h.audited.find((a) => a.action === 'access.audit_exported')
    expect(rec?.meta).toEqual(expect.objectContaining({ rows: 1, format: 'csv' }))
  })

  it('refuses more than 92 days and an unknown format', async () => {
    const r = await exportLog(post('/export', {
      format: 'json',
      filters: { from: '2026-01-01T00:00:00+05:30', to: '2026-11-01T00:00:00+05:30' },
    }))
    expect(r.status).toBe(400)
    expect((await exportLog(post('/export', { format: 'xlsx' }))).status).toBe(400)
  })

  it('records the export under a per-account lock before streaming', async () => {
    const r = await exportLog(post('/export', { format: 'json' }))
    expect(r.status).toBe(200)
    expect(h.locks).toEqual([`audit-export:${ACC}`])
    expect(h.audited.find((a) => a.action === 'access.audit_exported')?.meta).toEqual(expect.objectContaining({ format: 'json', rows: 1 }))
  })

  it('refuses the export when its record cannot be written (fail closed)', async () => {
    h.txFails = true
    const r = await exportLog(post('/export', { format: 'csv' }))
    expect(r.status).toBe(500)
    expect(r.headers.get('content-disposition')).toBeNull()
    expect((await r.json()).error).toMatch(/not started/)
    expect(h.audited).toHaveLength(0)
  })

  it('writes valid JSON with the chain head', async () => {
    const r = await exportLog(post('/export', { format: 'json' }))
    const body = JSON.parse(await r.text())
    expect(body.through_seq).toBe('9')
    expect(body.events).toHaveLength(1)
  })
})
})
