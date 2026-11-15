import { describe, expect, it } from 'vitest'
import { bestHour, cardFindings, type CardFacts } from './card-findings'

const hours = (pairs: Record<number, [number, number]>) =>
  Array.from({ length: 24 }, (_, h) => ({ calls: pairs[h]?.[0] ?? 0, connected: pairs[h]?.[1] ?? 0 }))

const base: CardFacts = {
  calls: 0, connected: 0, byHour: hours({}), onTimePct: null, followUpsCounted: 0,
  firstCallMedian: null, firstCallLeads: 0, idle: 0, overdueOpen: 0,
}

describe('bestHour', () => {
  it('the hour where the most calls are answered, among hours with enough calls', () => {
    expect(bestHour(hours({ 10: [10, 3], 17: [8, 6], 20: [2, 2] }))).toEqual({ hour: 17, pct: 75, calls: 8 })
  })
  it('none when no hour has enough calls', () => {
    expect(bestHour(hours({ 10: [2, 2] }))).toBeNull()
  })
})

describe('cardFindings', () => {
  it('nothing to say is one good line, not an empty box', () => {
    const f = cardFindings(base)
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('good')
  })

  it('low answer rate with enough calls names the hour people pick up', () => {
    const f = cardFindings({ ...base, calls: 30, connected: 9, byHour: hours({ 10: [20, 3], 18: [10, 6] }) })
    const low = f.find((x) => x.title.includes('answered'))
    expect(low?.severity).toBe('medium')
    expect(low?.suggestion).toContain('18:00')
  })

  it('a low answer rate from a handful of calls says nothing', () => {
    expect(cardFindings({ ...base, calls: 5, connected: 1 }).some((x) => x.title.includes('answered'))).toBe(false)
  })

  it('late follow-ups, slow first calls and idle leads each get a line', () => {
    const f = cardFindings({ ...base, onTimePct: 50, followUpsCounted: 10, firstCallMedian: 180, firstCallLeads: 8, idle: 4, overdueOpen: 6 })
    const titles = f.map((x) => x.title).join(' | ')
    expect(titles).toMatch(/follow-ups/i)
    expect(titles).toMatch(/first call/i)
    expect(titles).toMatch(/not touched/i)
    expect(f.find((x) => /overdue/i.test(x.title))?.severity).toBe('high')
    expect(f.some((x) => x.severity === 'good')).toBe(false)
  })

  it('a few follow-ups or first calls are too few to judge', () => {
    const f = cardFindings({ ...base, onTimePct: 0, followUpsCounted: 2, firstCallMedian: 999, firstCallLeads: 2 })
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('good')
  })

  it('every line is written by code, never labelled as AI', () => {
    expect(cardFindings({ ...base, idle: 2 }).every((x) => !x.byAi)).toBe(true)
  })
})
