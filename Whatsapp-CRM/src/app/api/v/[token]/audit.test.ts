import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A person's answer from their private "check your details" link is in
 * the audit log as a public action — confirmed or corrected — with the
 * names of the columns they changed and never what they typed.
 */

// Hex letters in every group: the sanitizer masks a run of 8+ digits, and an
// all-digit test uuid would be masked (reported to the foundation owner).
const V = 'a2222222-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACC = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ ctx: Record<string, unknown>; entry: Record<string, unknown> }>,
  verification: null as Record<string, unknown> | null,
  tab: [] as string[][],
}))

vi.mock('@/lib/audit/write', async (orig) => {
  const real = await orig<typeof import('@/lib/audit/write')>()
  return {
    ...real,
    audit: vi.fn(async (ctx: Record<string, unknown>, e: unknown) => {
      for (const entry of (Array.isArray(e) ? e : [e]) as Array<Record<string, unknown>>) h.calls.push({ ctx, entry })
    }),
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    sheetVerification: { findUnique: () => Promise.resolve(h.verification) },
    sheetVerificationPerson: { findUnique: () => Promise.resolve(null), upsert: () => Promise.resolve({}) },
    companyProfile: { findUnique: () => Promise.resolve({ display_name: 'Any Business', legal_name: null }) },
    account: { findUnique: () => Promise.resolve({ name: 'Any Business' }) },
  },
}))
vi.mock('@/lib/google/oauth', () => ({ googleAccessToken: () => Promise.resolve('tok') }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/google/sheets', () => ({
  readTab: () => Promise.resolve(h.tab),
  readRange: (_t: string, _s: string, range: string) => {
    const m = /!([A-Z]+)(\d+)/.exec(range)
    const col = m ? m[1].charCodeAt(0) - 65 : 0
    const row = m ? Number(m[2]) - 1 : 0
    return Promise.resolve([[h.tab[row]?.[col] ?? '']])
  },
  writeCells: () => Promise.resolve(),
  ensureTab: () => Promise.resolve({ sheetId: 1, created: false }),
  appendRows: () => Promise.resolve(),
  writeHeaderRow: () => Promise.resolve(),
  columnLetter: (i: number) => String.fromCharCode(65 + i),
  tabRange: (t: string) => `'${t}'`,
}))

import { POST } from './route'
import { signLink } from '@/lib/verify/sheet-verify-link'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { prepare } from '@/lib/audit/write'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret-for-verify'
})

const HEADERS = ['Name', 'Phone', 'Designation', 'Aadhaar', 'Verify ref', 'Verify status']
const REF = 'AAAA-BBBB-CCCC'
const tick = () => new Promise((r) => setTimeout(r, 0))

function post(body: unknown) {
  const token = signLink({ v: V, r: REF, k: 1 })
  return POST(
    new Request(`http://x/api/v/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ token }) },
  )
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.calls.length = 0
  h.verification = {
    id: V, account_id: ACC, status: 'active', deadline: new Date(Date.now() + 86_400_000), key_version: 1, language: 'en',
    spreadsheet_id: 'sheet', tab_title: 'List',
    name_column: 'Name', phone_column: 'Phone', email_column: null,
    show_columns: ['Designation', 'Aadhaar'], edit_columns: ['Name', 'Designation', 'Aadhaar'],
    filter_column: null, filter_value: null,
  }
  h.tab = [HEADERS, ['Someone Else', '9000000001', 'Clerk', '1111', 'ZZZZ-ZZZZ-ZZZZ', ''], ['Anu S', '9847012345', 'Secretary', '1234 5678 9012', REF, '']]
})

describe('audit of answers from a details link', () => {
  it('a confirm records public.details_confirmed as a public actor', async () => {
    expect((await post({ action: 'confirm' })).status).toBe(200)
    await tick()
    const ev = h.calls.filter((c) => c.entry.action === 'public.details_confirmed')
    expect(ev).toHaveLength(1)
    const row = prepare(ev[0].ctx as never, ev[0].entry as never)
    expect(row).toMatchObject({ actor_type: 'public', account_id: ACC, target_type: 'sheet_verification', target_id: V })
    expect(row.meta).toMatchObject({ verification_id: V, state: 'verified', fields: [] })
  })

  it('a correction records the column names only — never the old or new values', async () => {
    expect((await post({ action: 'correct', values: { Name: 'Anu S Nair' }, seen: { Name: 'Anu S' } })).status).toBe(200)
    await tick()
    const ev = h.calls.filter((c) => c.entry.action === 'public.details_confirmed')
    expect(ev).toHaveLength(1)
    expect(ev[0].entry.meta).toMatchObject({ state: 'corrected', fields: ['Name'] })
    const all = JSON.stringify(h.calls)
    expect(all).not.toMatch(/Anu S Nair|Anu S|9847012345|1234 5678 9012/)
  })

  it('a refused answer records nothing', async () => {
    expect((await post({ action: 'correct', values: { Aadhaar: '0000 0000 0000' }, seen: {} })).status).toBe(400)
    await tick()
    expect(h.calls.filter((c) => c.entry.action === 'public.details_confirmed')).toEqual([])
  })
})
