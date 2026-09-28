import { describe, it, expect } from 'vitest'
import {
  asDate,
  fillRecordPlaceholders,
  recordUnits,
  resolveMonth,
  searchTable,
  type LoadedTable,
  type SearchOutcome,
} from './table-search'
import { ungroundedListItems } from './list-grounding'

const TODAY = '2026-09-28'

function table(partial: Partial<LoadedTable> & Pick<LoadedTable, 'name' | 'fields' | 'rows'>): LoadedTable {
  return { tableId: partial.name, knowledgeId: `k-${partial.name}`, purpose: null, askFirst: null, upcomingBy: null, truncated: false, ...partial }
}

// A training institute's calendar (the shape ACSTI has).
const TRAINING = table({
  name: 'Training',
  fields: [
    { key: 'name', label: 'Name of programme', type: 'select' },
    { key: 'group', label: 'Target group', type: 'select' },
    { key: 'month', label: 'Month', type: 'select' },
    { key: 'from', label: 'Date from', type: 'date' },
    { key: 'to', label: 'Date To', type: 'date' },
    { key: 'fee', label: 'Fee', type: 'number' },
  ],
  rows: [
    { id: 'gold', data: { name: 'Gold loan Appraisal and Prevention of Fraud', group: 'All categories of Staff', month: 'october', from: '2026-10-16', to: '2026-10-17', fee: 2360 } },
    { id: 'stpm', data: { name: 'Statutory Training Programme (STP) (M)', group: 'Ministerial Cadre', month: 'october', from: '2026-10-12', to: '2026-10-16', fee: 5900 } },
    { id: 'stps', data: { name: 'Statutory Training Programme (STP) (S)', group: 'Sub-staff', month: 'september', from: '2026-09-29', to: '2026-10-01', fee: 3540 } },
    { id: 'stpsv', data: { name: 'Statutory Training Programme (STP) (SV)', group: 'Supervisory Cadre', month: 'october', from: '2026-10-26', to: '2026-10-31', fee: 7080 } },
  ],
})

// A hospital's doctors.
const DOCTORS = table({
  name: 'Doctors',
  fields: [
    { key: 'doctor', label: 'Doctor', type: 'text' },
    { key: 'dept', label: 'Department', type: 'select' },
    { key: 'days', label: 'OP days', type: 'text' },
    { key: 'fee', label: 'Consultation fee', type: 'number' },
  ],
  rows: [
    { id: 'd1', data: { doctor: 'Dr. Anil Kumar', dept: 'Cardiology', days: 'Mon, Thu', fee: 500 } },
    { id: 'd2', data: { doctor: 'Dr. Meera Nair', dept: 'Paediatrics', days: 'Tue, Fri', fee: 400 } },
    { id: 'd3', data: { doctor: 'Dr. Joseph', dept: 'Cardiology', days: 'Sat', fee: 800 } },
  ],
})

// A shop's price list.
const PRODUCTS = table({
  name: 'Products',
  fields: [
    { key: 'item', label: 'Product', type: 'text' },
    { key: 'price', label: 'Price', type: 'number' },
    { key: 'stock', label: 'In stock', type: 'select' },
  ],
  rows: [
    { id: 'p1', data: { item: 'Gold chain 22K', price: '45,000', stock: 'Yes' } },
    { id: 'p2', data: { item: 'Silver anklet', price: 1200, stock: 'Yes' } },
    { id: 'p3', data: { item: 'Gold ring', price: 18000, stock: 'No' } },
  ],
})

const ALL = [TRAINING, DOCTORS, PRODUCTS]

function records(outcome: SearchOutcome) {
  if (outcome.kind !== 'records') throw new Error(`expected records, got ${JSON.stringify(outcome)}`)
  return outcome
}

describe('finding rows exactly', () => {
  it('lists every programme in a month, soonest first — asked in Malayalam', () => {
    const r = records(searchTable(ALL, { table: 'Training', filters: [{ column: 'Month', match: 'is', value: 'ഒക്ടോബർ' }] }, TODAY))
    expect(r.matched).toBe(3)
    expect(r.records.map((x) => x.line.split(' — ')[0])).toEqual([
      '*Statutory Training Programme (STP) (M)*',
      '*Gold loan Appraisal and Prevention of Fraud*',
      '*Statutory Training Programme (STP) (SV)*',
    ])
  })

  it('reads a month against dates too, and "next month" from today', () => {
    const byDate = records(searchTable(ALL, { table: 'training', filters: [{ column: 'date from', match: 'in_month', value: 'next_month' }] }, TODAY))
    expect(byDate.matched).toBe(3)
  })

  it('keeps upcoming to what has not ended — a programme under way still counts', () => {
    const on30th = records(searchTable(ALL, { table: 'Training', upcoming_only: true }, '2026-09-30'))
    expect(on30th.records.some((x) => x.line.includes('(STP) (S)'))).toBe(true)
    const on2nd = records(searchTable(ALL, { table: 'Training', upcoming_only: true }, '2026-10-02'))
    expect(on2nd.records.some((x) => x.line.includes('(STP) (S)'))).toBe(false)
  })

  it('compares numbers as numbers, whatever the cell looks like', () => {
    const cheap = records(searchTable(ALL, { table: 'Products', filters: [{ column: 'price', match: 'at_most', value: '20000' }] }, TODAY))
    expect(cheap.records.map((x) => x.line)).toEqual(['*Silver anklet* — Price: 1,200 · In stock: Yes', '*Gold ring* — Price: 18,000 · In stock: No'])
  })

  it('finds words in either script — a hospital and a shop', () => {
    const cardio = records(searchTable(ALL, { table: 'Doctors', filters: [{ column: 'Department', match: 'is', value: 'cardiology' }, { column: 'Consultation fee', match: 'less_than', value: '600' }] }, TODAY))
    expect(cardio.records.map((x) => x.line.split(' — ')[0])).toEqual(['*Dr. Anil Kumar*'])
    const gold = records(searchTable(ALL, { table: 'Products', words: 'ഗോൾഡ്' }, TODAY))
    expect(gold.matched).toBe(2)
  })

  it('renders a row the same way every time: name, date range, the rest', () => {
    const r = records(searchTable(ALL, { table: 'Training', words: 'gold loan' }, TODAY))
    expect(r.records[0].line).toBe(
      '*Gold loan Appraisal and Prevention of Fraud* — 16 Oct 2026 – 17 Oct 2026 · Target group: All categories of Staff · Fee: 2,360',
    )
  })
})

describe('asking first', () => {
  it('will not list until the customer has chosen the column the business set', () => {
    const asks = searchTable([{ ...TRAINING, askFirst: 'month' }], { table: 'Training' }, TODAY)
    expect(asks).toMatchObject({ kind: 'needs', needs: 'Month', choices: ['october', 'september'] })
    const answered = searchTable([{ ...TRAINING, askFirst: 'month' }], { table: 'Training', filters: [{ column: 'Month', match: 'is', value: 'October' }] }, TODAY)
    expect(records(answered).matched).toBe(3)
  })

  it('does not ask when the customer already named what they want', () => {
    expect(searchTable([{ ...TRAINING, askFirst: 'month' }], { table: 'Training', words: 'gold' }, TODAY).kind).toBe('records')
  })
})

describe('saying what there is instead', () => {
  it('offers the months that do have rows when the asked month has none', () => {
    const r = records(searchTable(ALL, { table: 'Training', filters: [{ column: 'Date from', match: 'in_month', value: 'November' }] }, TODAY))
    expect(r.matched).toBe(0)
    expect(r.available).toEqual({ 'Date from': ['October', 'September'] })
    expect(r.note).toMatch(/Nothing matches/)
  })

  it('names the tables and columns there are when asked for one that is not', () => {
    expect(searchTable(ALL, { table: 'Courses' }, TODAY)).toMatchObject({ kind: 'error' })
    expect(searchTable(ALL, { table: 'Training', filters: [{ column: 'Venue', match: 'is', value: 'x' }] }, TODAY)).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('Its columns: Name of programme'),
    })
  })
})

describe('the exact rows in the reply', () => {
  const output = JSON.stringify(searchTable(ALL, { table: 'Training', filters: [{ column: 'Month', match: 'is', value: 'october' }] }, TODAY))

  it('puts the rendered rows where the reply wrote [[records]]', () => {
    const reply = fillRecordPlaceholders('ഒക്ടോബറിലെ പ്രോഗ്രാമുകൾ:\n\n[[records]]\n\nഏതിലാണ് താൽപ്പര്യം?', [output])
    expect(reply).toContain('- *Gold loan Appraisal and Prevention of Fraud* — 16 Oct 2026 – 17 Oct 2026')
    expect(reply).not.toContain('[[records]]')
  })

  it('drops a placeholder with no search behind it', () => {
    expect(fillRecordPlaceholders('Here:\n[[records]]', [])).toBe('Here:')
  })

  it('catches a retyped line whose fee belongs to another row', () => {
    const units = recordUnits([output])
    const right = '- *Gold loan Appraisal and Prevention of Fraud* — 16–17 Oct 2026, fee ₹2,360'
    const swapped = '- *Gold loan Appraisal and Prevention of Fraud* — 16–17 Oct 2026, fee ₹5,900'
    expect(ungroundedListItems(right, units)).toEqual([])
    expect(ungroundedListItems(swapped, units)).toEqual([swapped])
  })

  it('catches a row the search did not return', () => {
    const september = '- *Statutory Training Programme (STP) (S)* — 29 Sep 2026 – 1 Oct 2026 · Fee: 3,540'
    expect(ungroundedListItems(september, recordUnits([output]))).toEqual([september])
  })
})

describe('dates and months', () => {
  it('reads day-first dates and never a phone number', () => {
    expect(asDate('12/10/2026')).toBe('2026-10-12')
    expect(asDate('16 Oct 2026')).toBe('2026-10-16')
    expect(asDate('9496598031')).toBeNull()
    expect(asDate('31/02/2026')).toBeNull()
  })

  it('takes a month without a year as its next occurrence', () => {
    expect(resolveMonth('October', '2026-09-28')).toMatchObject({ year: 2026, month: 10 })
    expect(resolveMonth('October', '2026-11-05')).toMatchObject({ year: 2027, month: 10 })
    expect(resolveMonth('next_month', '2026-12-10')).toMatchObject({ year: 2027, month: 1 })
    expect(resolveMonth('2027-03', TODAY)).toMatchObject({ year: 2027, month: 3 })
  })
})
