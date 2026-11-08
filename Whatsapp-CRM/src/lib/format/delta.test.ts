import { describe, expect, it } from 'vitest'
import { formatChange } from './delta'

describe('formatChange', () => {
  it('is null when there is nothing to compare with', () => {
    for (const prev of [0, null, undefined]) {
      const c = formatChange(50, prev)
      expect(c.pct).toBeNull()
      expect(c.direction).toBeNull()
      expect(c.text).toBe('')
    }
    expect(formatChange(null, 40).pct).toBeNull()
  })
  it('rounds to one decimal below 10 and whole numbers otherwise', () => {
    expect(formatChange(1054, 1000)).toMatchObject({ pct: 5.4, direction: 'up', text: '+5.4%' })
    expect(formatChange(1500, 1000)).toMatchObject({ pct: 50, text: '+50%' })
    expect(formatChange(1126, 1000)).toMatchObject({ pct: 13, text: '+13%' })
    expect(formatChange(1050, 1000).text).toBe('+5%')
  })
  it('shows a fall with a minus sign', () => {
    expect(formatChange(80, 100)).toMatchObject({ pct: -20, direction: 'down', text: '-20%' })
    expect(formatChange(955, 1000)).toMatchObject({ pct: -4.5, text: '-4.5%' })
  })
  it('is flat when the figures match or round to zero', () => {
    expect(formatChange(100, 100)).toMatchObject({ pct: 0, direction: 'flat', text: 'No change' })
    expect(formatChange(100001, 100000).direction).toBe('flat')
  })
  it('flags small numbers, default threshold 20', () => {
    expect(formatChange(3, 2).small).toBe(true)
    expect(formatChange(100, 15).small).toBe(true)
    expect(formatChange(20, 20).small).toBe(false)
    expect(formatChange(5, 4, { smallBelow: 3 }).small).toBe(false)
  })
})
