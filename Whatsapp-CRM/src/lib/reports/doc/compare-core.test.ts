import { describe, expect, it } from 'vitest'
import { compareSentence, dimsFor, pickItems, summarise, type SliceRow } from './compare-core'

const stages = [
  { key: 'called', label: 'Called', outcome: 'open' as const },
  { key: 'appt', label: 'Appointment', outcome: 'open' as const },
  { key: 'won', label: 'Won', outcome: 'won' as const },
]

describe('dimsFor', () => {
  it('each report offers its own comparisons; periods always first', () => {
    expect(dimsFor('leads', false)).toEqual(['period', 'source', 'category', 'number'])
    expect(dimsFor('agents', false)).toEqual(['period', 'agent'])
    expect(dimsFor('sales', false)).toEqual(['period', 'category', 'agent'])
  })
  it("someone seeing only their own work compares only their own periods", () => {
    expect(dimsFor('agents', true)).toEqual(['period'])
    expect(dimsFor('leads', true)).toEqual(['period'])
  })
  it('a report without a Compare tab offers nothing', () => {
    expect(dimsFor('all', false)).toEqual([])
    expect(dimsFor('nope', false)).toEqual([])
  })
})

describe('pickItems', () => {
  const options = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }, { key: 'd', label: 'D' }, { key: 'e', label: 'E' }]
  it('keeps only known keys, once each, at most four', () => {
    expect(pickItems('b,zz,b,a,c,d,e', options)).toEqual(['b', 'a', 'c', 'd'])
  })
  it('nothing usable picks the first two options', () => {
    expect(pickItems('', options)).toEqual(['a', 'b'])
    expect(pickItems("x' OR 1=1", options)).toEqual(['a', 'b'])
  })
  it('one option is all there is', () => {
    expect(pickItems('', [{ key: 'a', label: 'A' }])).toEqual(['a'])
  })
})

const row = (key: string, o: Partial<SliceRow> = {}): SliceRow => ({ id: Math.random().toString(36).slice(2), key, day: '2026-11-10', won: false, lost: false, replyMin: null, source: null, ...o })

describe('summarise', () => {
  it('counts leads, won, lost, open, by day and reached stages per slice', () => {
    const rows = [row('a', { won: true }), row('a', { lost: true }), row('a', { day: '2026-11-11', replyMin: 10 }), row('b')]
    const marks = [{ leadId: rows[2].id, stageKey: 'appt' }]
    const s = summarise(rows, marks, stages, ['2026-11-10', '2026-11-11'])
    const a = s.get('a')!
    expect(a).toMatchObject({ leads: 3, won: 1, lost: 1, open: 1, byDay: [2, 1], replyMedian: 10 })
    expect(a.funnel.find((f) => f.key === 'appt')?.count).toBe(2) // the won lead passed it too
    expect(s.get('b')?.leads).toBe(1)
  })
  it('a slice with no leads is absent, never a row of zeros pretending to be data', () => {
    expect(summarise([], [], stages, []).size).toBe(0)
  })
})

describe('compareSentence', () => {
  const base = { leads: 40, won: 10, lost: 5, open: 25, byDay: [], replyMedian: null, sources: new Map(), funnel: stages.map((s) => ({ ...s, count: 0 })) }
  it('names the bigger won % and the stage with the widest gap', () => {
    const a = { ...base, won: 16, funnel: [{ ...stages[0], count: 30 }, { ...stages[1], count: 26 }, { ...stages[2], count: 16 }] }
    const b = { ...base, won: 8, funnel: [{ ...stages[0], count: 30 }, { ...stages[1], count: 12 }, { ...stages[2], count: 8 }] }
    const s = compareSentence([{ label: 'Parvathy', stats: a }, { label: 'Ananya', stats: b }])
    expect(s).toContain('Ananya')
    expect(s).toContain('20 points lower')
    expect(s).toContain('Appointment')
  })
  it('too few leads on either side says so instead of judging', () => {
    const s = compareSentence([{ label: 'A', stats: { ...base, leads: 4 } }, { label: 'B', stats: base }])
    expect(s).toMatch(/too few/i)
  })
  it('one item has nothing to compare', () => {
    expect(compareSentence([{ label: 'A', stats: base }])).toMatch(/pick at least two/i)
  })
})
