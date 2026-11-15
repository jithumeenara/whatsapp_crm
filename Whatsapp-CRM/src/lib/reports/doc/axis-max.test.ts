import { describe, expect, it } from 'vitest'
import { axisMax } from './pdf'

// Bug: a percent line peaking at 100% drew its axis up to 200%.
describe('axisMax', () => {
  it('a percent axis stops at 100% when nothing goes above it', () => {
    expect(axisMax([0, 44, 100], { kind: 'percent' })).toBe(100)
    expect(axisMax([10, 30], { kind: 'percent' })).toBe(40)
  })
  it('a percent above 100 (growth) still gets a round top', () => {
    expect(axisMax([150], { kind: 'percent' })).toBe(200)
  })
  it('counts keep the usual round top', () => {
    expect(axisMax([100], { kind: 'count' })).toBe(200)
    expect(axisMax([30], undefined)).toBe(40)
  })
})
