import { describe, it, expect } from 'vitest'
import { PAGE_SECTIONS, PAGE_ITEMS } from './pages'
import { NAV_SECTIONS } from './sections'

/**
 * The menu and the permission list are the same pages seen twice — one
 * with icons for the sidebar, one without so the server can read it
 * without pulling React into every API route. Two lists that must agree
 * are two lists that will not, unless something checks.
 */
describe('the menu and the grantable pages are the same list', () => {
  it('has the same sections, in the same order', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(PAGE_SECTIONS.map((s) => s.label))
  })

  it('has the same pages, in the same order', () => {
    const nav = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
    const pages = PAGE_ITEMS.map((i) => i.href)
    expect(nav).toEqual(pages)
  })

  it('keeps each page its label and its default', () => {
    for (const section of NAV_SECTIONS) {
      const source = PAGE_SECTIONS.find((s) => s.label === section.label)!
      for (const item of section.items) {
        const from = source.items.find((i) => i.href === item.href)!
        expect(item.label).toBe(from.label)
        expect(item.agentAllowed).toBe(from.agentAllowed)
      }
    }
  })

  it('gives every menu entry a real icon', () => {
    // A missing one falls back rather than crashing, which means a
    // forgotten icon ships as a wrong picture instead of an error.
    for (const item of NAV_SECTIONS.flatMap((s) => s.items)) {
      expect(item.icon, `${item.href} has no icon`).toBeTruthy()
    }
  })

  it('names no page twice', () => {
    const hrefs = PAGE_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
