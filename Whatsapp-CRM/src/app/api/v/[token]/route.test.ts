import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A person's answer from their private "check your details" link: only
 * their own row, only the columns the business allows, written back to
 * the business's Google Sheet as plain text; a cancelled or closed link
 * changes nothing.
 */

const V = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  verification: null as Record<string, unknown> | null,
  tab: [] as string[][],
  cells: [] as Array<{ row: number; col: number; value: string }>,
  logRows: [] as string[][],
  people: [] as Array<Record<string, unknown>>,
  /** What the sheet holds at the moment of writing, if it changed after the read. */
  movedTo: null as string[][] | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    sheetVerification: { findUnique: () => Promise.resolve(h.verification) },
    sheetVerificationPerson: {
      findUnique: () => Promise.resolve(null),
      upsert: (a: { update: Record<string, unknown> }) => { h.people.push(a.update); return Promise.resolve({}) },
    },
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
    const tab = h.movedTo ?? h.tab
    const col = m ? m[1].charCodeAt(0) - 65 : 0
    const row = m ? Number(m[2]) - 1 : 0
    return Promise.resolve([[tab[row]?.[col] ?? '']])
  },
  writeCells: (_t: string, _s: string, _tab: string, cells: Array<{ row: number; col: number; value: string }>) => { h.cells.push(...cells); return Promise.resolve() },
  ensureTab: () => Promise.resolve({ sheetId: 1, created: false }),
  appendRows: (_t: string, _s: string, _tab: string, rows: string[][]) => { h.logRows.push(...rows); return Promise.resolve() },
  writeHeaderRow: () => Promise.resolve(),
  columnLetter: (i: number) => String.fromCharCode(65 + i),
  tabRange: (t: string) => `'${t}'`,
}))

import { POST } from './route'
import { signLink } from '@/lib/verify/sheet-verify-link'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret-for-verify'
})

const HEADERS = ['Name', 'Phone', 'Designation', 'Aadhaar', 'Verify ref', 'Verify status']
const REF = 'AAAA-BBBB-CCCC'

function post(body: unknown, token = signLink({ v: V, r: REF, k: 1 }), ip = `10.0.0.${Math.floor(Math.random() * 250)}`) {
  return POST(
    new Request(`http://x/api/v/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ token }) },
  )
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.verification = {
    id: V, account_id: 'acc', status: 'active', deadline: new Date(Date.now() + 86_400_000), key_version: 1, language: 'en',
    spreadsheet_id: 'sheet', tab_title: 'List',
    name_column: 'Name', phone_column: 'Phone', email_column: null,
    show_columns: ['Designation', 'Aadhaar'], edit_columns: ['Name', 'Designation', 'Aadhaar'],
    filter_column: null, filter_value: null,
  }
  h.tab = [HEADERS, ['Someone Else', '9000000001', 'Clerk', '1111', 'ZZZZ-ZZZZ-ZZZZ', ''], ['Anu S', '9847012345', 'Secretary', '1234 5678 9012', REF, '']]
  h.cells = []
  h.logRows = []
  h.people = []
  h.movedTo = null
})

describe('a person answering from their private link', () => {
  it('confirming marks only their own row', async () => {
    const res = await post({ action: 'confirm' })
    expect(res.status).toBe(200)
    expect(h.cells).toEqual([{ row: 3, col: 5, value: expect.stringMatching(/^Verified · /) }])
    expect(h.people[0]).toMatchObject({ state: 'verified' })
  })

  it('a correction is written to that row as text, logged, and nothing else changes', async () => {
    const res = await post({ action: 'correct', values: { Name: 'Anu S Nair' }, seen: { Name: 'Anu S' } })
    expect(res.status).toBe(200)
    expect(h.cells).toEqual(expect.arrayContaining([{ row: 3, col: 0, value: 'Anu S Nair' }, { row: 3, col: 5, value: expect.stringMatching(/^Corrected · /) }]))
    expect(h.cells.some((c) => c.row !== 3)).toBe(false)
    expect(h.logRows).toEqual([[expect.any(String), REF, 'Name', 'Anu S', 'Anu S Nair', 'Person']])
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('1234 5678 9012')
  })

  it('an ID number or the phone can never be changed, whatever the settings say', async () => {
    expect((await post({ action: 'correct', values: { Aadhaar: '0000 0000 0000' }, seen: {} })).status).toBe(400)
    expect((await post({ action: 'correct', values: { Phone: '9000000000' }, seen: {} })).status).toBe(400)
    expect(h.cells).toEqual([])
  })

  it('asks to reload when someone changed the row after the page was opened', async () => {
    const res = await post({ action: 'correct', values: { Designation: 'President' }, seen: { Designation: 'Treasurer' } })
    expect(res.status).toBe(409)
    expect(h.cells).toEqual([])
  })

  it('a link for another row cannot be made by editing this one', async () => {
    const good = signLink({ v: V, r: REF, k: 1 })
    const forged = `${Buffer.from(JSON.stringify([V, 'ZZZZ-ZZZZ-ZZZZ', 1])).toString('base64url')}.${good.split('.')[1]}`
    expect((await post({ action: 'confirm' }, forged)).status).toBe(404)
    expect(h.cells).toEqual([])
  })

  it('links cancelled by the business, or past the deadline, change nothing', async () => {
    h.verification = { ...h.verification!, key_version: 2 }
    expect((await post({ action: 'confirm' })).status).toBe(404)
    h.verification = { ...h.verification!, key_version: 1, deadline: new Date(Date.now() - 1000) }
    expect((await post({ action: 'confirm' })).status).toBe(410)
    h.verification = { ...h.verification!, deadline: null, status: 'closed' }
    expect((await post({ action: 'confirm' })).status).toBe(410)
    expect(h.cells).toEqual([])
  })

  it('a row removed from the sheet is not found', async () => {
    h.tab = [HEADERS, h.tab[1]]
    expect((await post({ action: 'confirm' })).status).toBe(404)
  })

  it('opening the page many times never uses up the answers a person can send (bug)', async () => {
    const token = signLink({ v: V, r: REF, k: 1 })
    for (let i = 0; i < 15; i++) await post({ action: 'opened' }, token, '10.9.9.9')
    expect((await post({ action: 'confirm' }, token, '10.9.9.9')).status).toBe(200)
  })

  it('too many answers from one link are refused', async () => {
    const token = signLink({ v: V, r: REF, k: 1 })
    let last = 200
    for (let i = 0; i < 12; i++) last = (await post({ action: 'confirm' }, token)).status
    expect(last).toBe(429)
  })
  it('a ref copied onto another row opens nothing and changes nothing (bug: a copied row showed the first person’s details)', async () => {
    h.tab = [HEADERS, ['Copy Person', '9000000002', 'Clerk', '2222', REF, ''], h.tab[2]]
    expect((await post({ action: 'confirm' })).status).toBe(409)
    expect(h.cells).toEqual([])
  })

  it('a copy outside the list’s filter is never served', async () => {
    h.verification = { ...h.verification!, filter_column: 'Designation', filter_value: 'Secretary' }
    h.tab = [HEADERS, h.tab[1], ['Anu S', '9847012345', 'Clerk', '1234', REF, '']]
    expect((await post({ action: 'confirm' })).status).toBe(404)
    expect(h.cells).toEqual([])
  })

  it('when rows moved between reading and writing, nothing is written to whoever is there now (bug)', async () => {
    h.movedTo = [HEADERS, h.tab[2], h.tab[1]]
    const res = await post({ action: 'correct', values: { Name: 'Anu S Nair' }, seen: { Name: 'Anu S' } })
    expect(res.status).toBe(409)
    expect(h.cells).toEqual([])
  })
})

