import { describe, expect, it } from 'vitest'
import { PDF_BUILD_SLOTS, tryAcquirePdfSlot } from './build-slots'

/**
 * A PDF build uses a CPU for seconds, so only a couple may run at once in a
 * process, whichever report asked for them. One shared counter, not one per
 * route: two routes with their own counters would allow four.
 */
describe('tryAcquirePdfSlot', () => {
  it('hands out the allowed number of slots and then says no', () => {
    const held = Array.from({ length: PDF_BUILD_SLOTS }, () => tryAcquirePdfSlot())
    expect(held.every((r) => typeof r === 'function')).toBe(true)
    expect(tryAcquirePdfSlot()).toBeNull()
    held.forEach((r) => r!())
  })

  it('frees a slot when it is released, so the feature never stays locked', () => {
    const held = Array.from({ length: PDF_BUILD_SLOTS }, () => tryAcquirePdfSlot())
    expect(tryAcquirePdfSlot()).toBeNull()
    held[0]!()
    const again = tryAcquirePdfSlot()
    expect(again).not.toBeNull()
    again!()
    held.slice(1).forEach((r) => r!())
  })

  it('counts a release once, however many times it is called', () => {
    const held = Array.from({ length: PDF_BUILD_SLOTS }, () => tryAcquirePdfSlot())
    held[0]!()
    held[0]!()
    held[0]!()
    // Only one slot came back, not three: the next two askers get one yes and one no.
    const a = tryAcquirePdfSlot()
    const b = tryAcquirePdfSlot()
    expect(a).not.toBeNull()
    expect(b).toBeNull()
    a!()
    held.slice(1).forEach((r) => r!())
  })

  it('is empty again once everything has been released', () => {
    const r = tryAcquirePdfSlot()
    r!()
    const all = Array.from({ length: PDF_BUILD_SLOTS }, () => tryAcquirePdfSlot())
    expect(all.every((x) => x !== null)).toBe(true)
    all.forEach((x) => x!())
  })
})
