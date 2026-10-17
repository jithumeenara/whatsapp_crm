import { describe, expect, it } from 'vitest'
import { ID_HEADER, planSync, type Plan, type PlanInput, type Snapshot } from './sheet-two-way-plan'

/**
 * A tiny in-memory sheet + table, so each test can sync, apply what the
 * plan says, and sync again — the second run must find nothing to do.
 */
interface World {
  header: string[]
  rows: string[][]
  records: Map<string, Record<string, unknown>>
  snapshots: Map<string, Snapshot>
  held: Set<string>
}

const FIELDS = [
  { field_key: 'name', field_type: 'text' },
  { field_key: 'fee', field_type: 'number' },
  { field_key: 'paid', field_type: 'boolean' },
  { field_key: 'secret', field_type: 'password' },
]
const MAP = { Name: 'name', Fee: 'fee', Paid: 'paid', Secret: 'secret' }

let counter = 0
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function plan(w: World, extra: Partial<PlanInput> = {}): Plan {
  return planSync({
    header: w.header,
    rows: w.rows,
    columnMap: MAP,
    fields: FIELDS,
    records: [...w.records].map(([id, data]) => ({ id, data })),
    snapshots: w.snapshots,
    heldDeletes: w.held,
    allowDeletes: false,
    newId,
    ...extra,
  })
}

/** Does to the world what sheet-two-way.ts does to Google and the DB. */
function apply(w: World, p: Plan): void {
  if (p.stopped) return
  if (p.writeIdHeader) w.header[p.idCol] = ID_HEADER
  for (const c of p.cellWrites) {
    while (w.rows[c.row].length <= c.col) w.rows[c.row].push('')
    w.rows[c.row][c.col] = c.value
  }
  w.rows = w.rows.filter((_, i) => !p.deleteSheetRows.includes(i))
  w.rows.push(...p.appendRows.map((r) => [...r]))
  for (const r of p.createRecords) w.records.set(r.id, r.data)
  for (const r of p.updateRecords) w.records.set(r.id, r.data)
  for (const id of p.deleteRecords) w.records.delete(id)
  w.snapshots = p.snapshots
  w.held = new Set(p.held)
}

const quiet = (p: Plan) =>
  p.createRecords.length + p.updateRecords.length + p.deleteRecords.length + p.cellWrites.length + p.appendRows.length + p.deleteSheetRows.length

function world(rows: string[][], records: Array<[string, Record<string, unknown>]> = []): World {
  return { header: ['Name', 'Fee', 'Paid'], rows, records: new Map(records), snapshots: new Map(), held: new Set() }
}

/** Sync until settled, as the debounced runner would. */
function settle(w: World): Plan {
  const p = plan(w)
  apply(w, p)
  return p
}

describe('first sync', () => {
  it('brings sheet rows in as records, writes their ids, and adds the id column', () => {
    const w = world([['Asha', '5,000', 'Yes'], ['Binu', '', 'No']])
    const p = settle(w)
    expect(p.writeIdHeader).toBe(true)
    expect(p.stats.fromSheet.created).toBe(2)
    const [a] = [...w.records.values()]
    expect(a).toEqual({ name: 'Asha', fee: 5000, paid: true })
    expect(w.header[3]).toBe(ID_HEADER)
    expect(w.rows[0][3]).toMatch(/^0000/)
    expect(quiet(plan(w))).toBe(0)
  })

  it('adds records the sheet does not have', () => {
    const w = world([], [['r-1', { name: 'Chitra', fee: 700 }]])
    w.records = new Map([['00000000-0000-4000-8000-0000000000aa', { name: 'Chitra', fee: 700 }]])
    const p = settle(w)
    expect(p.stats.toSheet.added).toBe(1)
    expect(w.rows[0].slice(0, 2)).toEqual(['Chitra', '700'])
    expect(quiet(plan(w))).toBe(0)
  })

  it('adopts rows an earlier import already brought in, instead of duplicating them', () => {
    const id = '00000000-0000-4000-8000-0000000000bb'
    const w = world([['Devi', '900', 'Yes'], ['Devi', '900', 'Yes']], [[id, { name: 'Devi', fee: 900, paid: true }]])
    w.records.set('00000000-0000-4000-8000-0000000000bc', { name: 'Devi', fee: 900, paid: true })
    const p = settle(w)
    expect(p.createRecords).toHaveLength(0)
    expect(p.appendRows).toHaveLength(0)
    expect(w.records.size).toBe(2)
    expect(new Set(w.rows.map((r) => r[3])).size).toBe(2)
  })

  it('adopts a row whose number is formatted differently from the record', () => {
    const id = '00000000-0000-4000-8000-0000000000bd'
    const w = world([['Gita', '5,000', 'TRUE']], [[id, { name: 'Gita', fee: 5000, paid: true }]])
    const p = settle(w)
    expect(p.createRecords).toHaveLength(0)
    expect(w.rows[0][3]).toBe(id)
    expect(quiet(plan(w))).toBe(0)
  })
})

describe('edits', () => {
  function synced(): World {
    const w = world([['Asha', '5000', 'Yes']])
    settle(w)
    return w
  }

  it('an edit in the sheet updates just that field in the CRM', () => {
    const w = synced()
    const [id] = [...w.records.keys()]
    w.records.set(id, { ...w.records.get(id), note: 'kept' })
    w.rows[0][1] = '6000'
    const p = settle(w)
    expect(p.stats.fromSheet.updated).toBe(1)
    expect(w.records.get(id)).toEqual({ name: 'Asha', fee: 6000, paid: true, note: 'kept' })
    expect(quiet(plan(w))).toBe(0)
  })

  it('an edit in the CRM is written to its cell', () => {
    const w = synced()
    const [id] = [...w.records.keys()]
    w.records.set(id, { name: 'Asha K', fee: 5000, paid: true })
    const p = settle(w)
    expect(p.cellWrites).toEqual([{ row: 0, col: 0, value: 'Asha K' }])
    expect(w.rows[0][0]).toBe('Asha K')
    expect(quiet(plan(w))).toBe(0)
  })

  it('different fields edited on each side are both kept', () => {
    const w = synced()
    const [id] = [...w.records.keys()]
    w.records.set(id, { name: 'Asha K', fee: 5000, paid: true })
    w.rows[0][1] = '6000'
    settle(w)
    expect(w.records.get(id)).toMatchObject({ name: 'Asha K', fee: 6000 })
    expect(w.rows[0].slice(0, 2)).toEqual(['Asha K', '6000'])
  })

  it('the same field edited on both sides: the sheet wins', () => {
    const w = synced()
    const [id] = [...w.records.keys()]
    w.records.set(id, { name: 'From CRM', fee: 5000, paid: true })
    w.rows[0][0] = 'From sheet'
    settle(w)
    expect(w.records.get(id)).toMatchObject({ name: 'From sheet' })
  })

  it('a renamed column is left alone on both sides, not read as emptied', () => {
    const w = synced()
    const [id] = [...w.records.keys()]
    w.header[1] = 'Amount'
    const p = settle(w)
    expect(p.warnings[0]).toContain('"Fee"')
    expect(w.records.get(id)).toMatchObject({ fee: 5000 })
  })

  it('never sends a password field to the sheet', () => {
    const w = world([], [['00000000-0000-4000-8000-0000000000cc', { name: 'Eva', secret: 'hunter2' }]])
    w.header = ['Name', 'Fee', 'Paid', 'Secret']
    settle(w)
    expect(w.rows.flat()).not.toContain('hunter2')
  })
})

describe('deletions', () => {
  function synced(n: number): World {
    const w = world(Array.from({ length: n }, (_, i) => [`P${i}`, String(i), 'No']))
    settle(w)
    return w
  }

  it('a row deleted in the sheet deletes its record', () => {
    const w = synced(10)
    const gone = w.rows[4][3]
    w.rows.splice(4, 1)
    const p = settle(w)
    expect(p.deleteRecords).toEqual([gone])
    expect(w.records.has(gone)).toBe(false)
  })

  it('holds a bulk deletion for a person to confirm, deleting nothing', () => {
    const w = synced(10)
    w.rows.splice(0, 5)
    const p = settle(w)
    expect(p.deleteRecords).toEqual([])
    expect(p.held).toHaveLength(5)
    expect(w.records.size).toBe(10)
    // Not re-added to the sheet while held either.
    expect(p.appendRows).toHaveLength(0)
    // Confirmed: now they go.
    const confirmed = plan(w, { allowDeletes: true })
    expect(confirmed.deleteRecords).toHaveLength(5)
  })

  it('holds everything when the sheet is emptied', () => {
    const w = synced(2)
    w.rows = []
    const p = settle(w)
    expect(p.deleteRecords).toEqual([])
    expect(p.held).toHaveLength(2)
  })

  it('a record deleted in the CRM removes its row', () => {
    const w = synced(3)
    const id = w.rows[1][3]
    w.records.delete(id)
    const p = settle(w)
    expect(p.deleteSheetRows).toEqual([1])
    expect(w.rows.map((r) => r[3])).not.toContain(id)
    expect(quiet(plan(w))).toBe(0)
  })

  it('does nothing at all when the CRM ID column was removed', () => {
    const w = synced(3)
    w.header = w.header.slice(0, 3)
    w.rows = w.rows.map((r) => r.slice(0, 3))
    const p = plan(w)
    expect(p.stopped).toContain(ID_HEADER)
    expect(quiet(p)).toBe(0)
  })
})

describe('copied rows', () => {
  it('a row pasted with another row\'s id becomes its own record', () => {
    const w = world([['Asha', '5000', 'Yes']])
    settle(w)
    w.rows.push([...w.rows[0]])
    w.rows[1][0] = 'Asha (copy)'
    const p = settle(w)
    expect(p.stats.fromSheet.created).toBe(1)
    expect(w.rows[0][3]).not.toBe(w.rows[1][3])
    expect(w.records.size).toBe(2)
    expect(quiet(plan(w))).toBe(0)
  })
})
