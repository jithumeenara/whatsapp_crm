import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Settings → Business profile: country, currency, tax number, report language.
 *
 * Who may change it (admins), what is accepted (only listed countries,
 * currencies and languages, any case), what is ignored (every other field of
 * the body: users never set their own ids or files here), and what happens
 * when the currency changes (the change date is recorded, history keeps its
 * currency, costs that had no rate card are priced again).
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  account: { default_currency: 'USD' } as { default_currency: string },
  profile: null as null | Record<string, any>,
  upserts: [] as Array<Record<string, any>>,
  accountUpdates: [] as Array<Record<string, any>>,
  audits: [] as Array<Record<string, any>>,
  repriced: [] as string[],
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  return {
    ForbiddenError,
    requireRole: (min: string) => {
      if ((rank[h.role] ?? 0) < (rank[min] ?? 99)) throw new ForbiddenError('no')
      return Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: h.role })
    },
    toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({
  auditConfigChange: (_c: unknown, action: string, opts: Record<string, any>) => {
    h.audits.push({ action, ...opts })
    return Promise.resolve()
  },
}))
vi.mock('@/lib/whatsapp/message-cost', () => ({
  repriceUnpricedCosts: (accountId: string) => {
    h.repriced.push(accountId)
    return Promise.resolve(0)
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: {
      findUnique: () => Promise.resolve(h.account),
      update: ({ data }: any) => {
        h.accountUpdates.push(data)
        h.account = { ...h.account, ...data }
        return Promise.resolve(h.account)
      },
    },
    accountReportProfile: {
      findUnique: () => Promise.resolve(h.profile),
      upsert: ({ update, create }: any) => {
        h.upserts.push({ update, create })
        h.profile = { ...(h.profile ?? {}), ...update }
        return Promise.resolve(h.profile)
      },
    },
  },
}))

import { GET, PUT } from './route'

const put = (body: unknown) =>
  PUT(new Request('http://x/api/business-profile', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  h.role = 'admin'
  h.account = { default_currency: 'USD' }
  h.profile = null
  h.upserts = []
  h.accountUpdates = []
  h.audits = []
  h.repriced = []
})

describe('PUT /api/business-profile: who and what', () => {
  it('is for admins only', async () => {
    for (const role of ['viewer', 'agent', 'supervisor']) {
      h.role = role
      expect((await put({ country_iso: 'IN' })).status).toBe(403)
    }
    expect(h.upserts).toHaveLength(0)
  })

  it('refuses a country, currency or language that is not in the lists, in plain words', async () => {
    for (const body of [{ country_iso: 'ZZ' }, { currency: 'ABC' }, { report_language: 'xx' }, { report_language: '../etc' }]) {
      const res = await put(body)
      expect(res.status).toBe(400)
      expect(typeof (await res.json()).error).toBe('string')
    }
    expect(h.upserts).toHaveLength(0)
    expect(h.accountUpdates).toHaveLength(0)
  })

  it('refuses a tax number with odd characters or an absurd length', async () => {
    expect((await put({ tax_id: '<script>alert(1)</script>' })).status).toBe(400)
    expect((await put({ tax_id: 'A'.repeat(41) })).status).toBe(400)
  })

  it('stores country and currency upper case whatever case came in, and trims the tax number', async () => {
    const res = await put({ country_iso: 'in', currency: 'inr', tax_id: '  29AAAAA0000A1Z5  ', report_language: 'ml' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].update).toMatchObject({ country_iso: 'IN', tax_id: '29AAAAA0000A1Z5', report_language: 'ml' })
    expect(h.accountUpdates[0].default_currency).toBe('INR')
  })

  it('clears a field when it is sent empty', async () => {
    await put({ country_iso: null, tax_id: '' })
    expect(h.upserts[0].update).toMatchObject({ country_iso: null, tax_id: null })
  })

  it('copies only the allowed fields: ids and files in the body are ignored', async () => {
    await put({ country_iso: 'IN', account_id: 'someone-else', logo_file_id: 'other-file', updated_at: '2000-01-01' })
    const written = Object.keys(h.upserts[0].update)
    expect(written).not.toContain('account_id')
    expect(written).not.toContain('logo_file_id')
    // The server stamps updated_at itself; the body's value is never used.
    expect(h.upserts[0].update.updated_at).toBeInstanceOf(Date)
    expect(h.upserts[0].create.account_id).toBe('acc-1')
  })
})

describe('PUT /api/business-profile: changing the currency', () => {
  it('records when it changed and prices again the costs that had no rate card', async () => {
    await put({ currency: 'INR' })
    expect(h.accountUpdates).toHaveLength(1)
    expect(h.upserts[0].update.currency_effective_from).toBeInstanceOf(Date)
    expect(h.repriced).toEqual(['acc-1'])
  })

  it('does nothing about currency when it is the same one', async () => {
    h.account = { default_currency: 'INR' }
    await put({ currency: 'inr', tax_id: '123' })
    expect(h.accountUpdates).toHaveLength(0)
    expect(h.upserts[0].update.currency_effective_from).toBeUndefined()
    expect(h.repriced).toHaveLength(0)
  })

  it('is audited by field name only, never by value', async () => {
    await put({ currency: 'INR', tax_id: 'SECRET-TAX-123' })
    expect(h.audits.length).toBeGreaterThan(0)
    expect(JSON.stringify(h.audits)).not.toContain('SECRET-TAX-123')
    expect(h.audits[0].fields).toEqual(expect.arrayContaining(['currency', 'tax_id']))
  })
})

describe('GET /api/business-profile', () => {
  it('shows any member the business details, with the logo as a link and never as a file id', async () => {
    h.role = 'viewer'
    h.account = { default_currency: 'INR' }
    h.profile = { country_iso: 'IN', tax_id: 'T1', report_language: 'en', logo_file_id: 'file-1', currency_effective_from: null }
    const res = await GET()
    const body = await res.json()
    expect(body).toMatchObject({ country_iso: 'IN', currency: 'INR', tax_id: 'T1', report_language: 'en', has_logo: true })
    expect(JSON.stringify(body)).not.toContain('file-1')
  })

  it('answers with sensible empties when nothing was ever saved', async () => {
    const body = await (await GET()).json()
    expect(body).toMatchObject({ country_iso: null, tax_id: null, report_language: 'en', has_logo: false })
  })
})
