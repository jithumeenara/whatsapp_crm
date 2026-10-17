import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The runner: reads the tab, applies the plan to the database and the
 * sheet in the right order and at the right row numbers, remembers the
 * snapshots, and keeps every write inside the link's own table.
 */

const LINK = '11111111-1111-4111-8111-111111111111'
const TABLE = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  sheet: [] as string[][],
  records: [] as Array<{ id: string; data: Record<string, unknown> }>,
  snapshots: [] as Array<{ record_id: string; snapshot: Record<string, string> }>,
  created: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: Record<string, unknown>; data: unknown }>,
  deletes: [] as Array<Record<string, unknown>>,
  cellWrites: [] as Array<{ row: number; col: number; value: string }>,
  deletedRows: [] as number[],
  appended: [] as string[][],
  linkUpdates: [] as Array<Record<string, unknown>>,
  savedSnapshots: [] as Array<{ record_id: string }>,
  held: [] as string[],
  tokenEnc: null as string | null,
}))

vi.mock('@/lib/db', () => {
  const link = () => ({
    id: LINK,
    account_id: 'acc',
    table_id: TABLE,
    direction: 'sync',
    spreadsheet_id: 'sheet-id-aaaaaaaaaaaaaaaaaaaa',
    sheet_title: 'Students',
    column_map: { Name: 'name', Fee: 'fee' },
    held_deletes: h.held,
    sync_token_enc: h.tokenEnc,
  })
  return {
    prisma: {
      googleSheetLink: {
        findFirst: () => Promise.resolve(link()),
        findUnique: () => Promise.resolve(link()),
        update: (a: { data: Record<string, unknown> }) => {
          h.linkUpdates.push(a.data)
          if (typeof a.data.sync_token_enc === 'string') h.tokenEnc = a.data.sync_token_enc
          return Promise.resolve({})
        },
      },
      dataField: {
        findMany: () => Promise.resolve([{ field_key: 'name', field_type: 'text' }, { field_key: 'fee', field_type: 'number' }]),
      },
      dataRecord: {
        findMany: () => Promise.resolve(h.records),
        createMany: (a: { data: Array<Record<string, unknown>> }) => {
          h.created.push(...a.data)
          return Promise.resolve({ count: a.data.length })
        },
        updateMany: (a: { where: Record<string, unknown>; data: unknown }) => {
          h.updates.push(a)
          return Promise.resolve({ count: 1 })
        },
        deleteMany: (a: { where: Record<string, unknown> }) => {
          h.deletes.push(a.where)
          return Promise.resolve({ count: 1 })
        },
      },
      googleSheetRow: {
        findMany: () => Promise.resolve(h.snapshots),
        deleteMany: () => Promise.resolve({ count: 0 }),
        createMany: (a: { data: Array<{ record_id: string }> }) => {
          h.savedSnapshots.push(...a.data)
          return Promise.resolve({ count: a.data.length })
        },
      },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  }
})
vi.mock('./store', () => ({ ensureGoogleTables: () => Promise.resolve() }))
vi.mock('./oauth', () => ({
  googleAccessToken: () => Promise.resolve('tok'),
  isGoogleServiceEnabled: (_a: string, id: string) => Promise.resolve(id === 'sheets_sync'),
}))
vi.mock('./sheets', () => ({
  SHEET_MAX_ROWS: 2000,
  SheetsApiError: class extends Error {
    constructor(m: string, readonly status: number) { super(m) }
  },
  readTab: () => Promise.resolve(h.sheet.map((r) => [...r])),
  writeCells: (_t: string, _s: string, _title: string, cells: Array<{ row: number; col: number; value: string }>) => {
    h.cellWrites.push(...cells)
    return Promise.resolve()
  },
  deleteRows: (_t: string, _s: string, _gid: number, rows: number[]) => {
    h.deletedRows.push(...rows)
    return Promise.resolve()
  },
  appendRows: (_t: string, _s: string, _title: string, rows: string[][]) => {
    h.appended.push(...rows)
    return Promise.resolve()
  },
  getSpreadsheet: () => Promise.resolve({ id: 'x', title: 'X', tabs: [{ sheetId: 77, title: 'Students' }] }),
}))
vi.mock('./sheet-sync', () => ({ columnMapOf: (v: unknown) => v as Record<string, string> }))
vi.mock('@/lib/ai/knowledge-refresh', () => ({ scheduleKnowledgeRefresh: () => {} }))

import { appsScriptFor, checkPing, pingToken, runSheetSync } from './sheet-two-way'

const ID1 = '00000000-0000-4000-8000-000000000001'
const ID2 = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  Object.assign(h, {
    sheet: [], records: [], snapshots: [], created: [], updates: [], deletes: [], cellWrites: [],
    deletedRows: [], appended: [], linkUpdates: [], savedSnapshots: [], held: [],
  })
})

describe('a sync run', () => {
  it('creates records for new sheet rows and writes their ids at the right row numbers', async () => {
    h.sheet = [['Name', 'Fee'], ['Asha', '5000'], ['', ''], ['Binu', '700']]
    const r = await runSheetSync(LINK, 'acc')
    expect(r.ok).toBe(true)
    expect(h.created).toHaveLength(2)
    expect(h.created[0]).toMatchObject({ table_id: TABLE, account_id: 'acc', source: 'google_sheet', data: { name: 'Asha', fee: 5000 } })
    // Header cell for the id column (C1), then ids on sheet rows 2 and 4.
    expect(h.cellWrites[0]).toEqual({ row: 1, col: 2, value: 'CRM ID' })
    expect(h.cellWrites.slice(1).map((c) => [c.row, c.col])).toEqual([[2, 2], [4, 2]])
    expect(h.savedSnapshots).toHaveLength(2)
  })

  it('deletes only within the link\'s own table and account', async () => {
    h.sheet = [['Name', 'Fee', 'CRM ID'], ['Asha', '5000', ID1]]
    h.records = [{ id: ID1, data: { name: 'Asha', fee: 5000 } }, { id: ID2, data: { name: 'Gone', fee: 1 } }]
    h.snapshots = [
      { record_id: ID1, snapshot: { name: 'Asha', fee: '5000' } },
      { record_id: ID2, snapshot: { name: 'Gone', fee: '1' } },
    ]
    await runSheetSync(LINK, 'acc')
    expect(h.deletes).toEqual([{ id: { in: [ID2] }, table_id: TABLE, account_id: 'acc' }])
  })

  it('removes the row of a record deleted in the CRM, by its sheet row number and tab id', async () => {
    h.sheet = [['Name', 'Fee', 'CRM ID'], ['Asha', '5000', ID1], ['Binu', '700', ID2]]
    h.records = [{ id: ID1, data: { name: 'Asha', fee: 5000 } }]
    h.snapshots = [
      { record_id: ID1, snapshot: { name: 'Asha', fee: '5000' } },
      { record_id: ID2, snapshot: { name: 'Binu', fee: '700' } },
    ]
    await runSheetSync(LINK, 'acc')
    expect(h.deletedRows).toEqual([3])
    expect(h.deletes).toEqual([])
  })

  it('changes nothing and says why when the id column is gone', async () => {
    h.sheet = [['Name', 'Fee'], ['Asha', '5000']]
    h.records = [{ id: ID1, data: { name: 'Asha', fee: 5000 } }]
    h.snapshots = [{ record_id: ID1, snapshot: { name: 'Asha', fee: '5000' } }]
    const r = await runSheetSync(LINK, 'acc')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('CRM ID')
    expect(h.created.length + h.deletes.length + h.cellWrites.length + h.appended.length).toBe(0)
  })
})

describe('the instant ping', () => {
  it('accepts the link\'s own token and nothing else', async () => {
    const token = await pingToken(LINK)
    expect((await checkPing(LINK, token)).ok).toBe(true)
    expect((await checkPing(LINK, token + 'x')).ok).toBe(false)
    expect((await checkPing(LINK, 'a'.repeat(32))).ok).toBe(false)
  })

  it('keeps the same token, so an installed script keeps working', async () => {
    expect(await pingToken(LINK)).toBe(await pingToken(LINK))
  })

  it('the script carries no sheet data, only the link and its token', () => {
    const script = appsScriptFor('https://crm.example.com', LINK, 'TOKEN123')
    expect(script).toContain("payload: JSON.stringify({ link: LINK, token: TOKEN })")
    expect(script).not.toMatch(/getValues|getRange|getDataRange/)
  })
})
