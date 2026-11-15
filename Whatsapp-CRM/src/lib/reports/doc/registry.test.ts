import { describe, expect, it, vi } from 'vitest'

// The builders reach the database; access rules are tested without them.
vi.mock('./reports/all', () => ({ allReport: vi.fn() }))
vi.mock('./reports/leads', () => ({ leadReport: vi.fn() }))
vi.mock('./reports/agents', () => ({ agentReport: vi.fn() }))
vi.mock('./reports/sales', () => ({ salesReport: vi.fn() }))
vi.mock('./reports/spending', () => ({ spendingReport: vi.fn() }))
vi.mock('./reports/ads', () => ({ adReport: vi.fn() }))

import { accessFor, findReport, menuFor } from './registry'

/** Who sees what, in one place: the menu, the screen and every export use it. */
describe('report access', () => {
  const agent = { userId: 'a1', role: 'agent' as const }
  const viewer = { userId: 'v1', role: 'viewer' as const }
  const supervisor = { userId: 's1', role: 'supervisor' as const }
  const admin = { userId: 'd1', role: 'admin' as const }

  it('an agent gets their own numbers only, no exports, no money reports', () => {
    expect(accessFor(findReport('leads')!, agent)).toMatchObject({ allowed: true, userId: 'a1', canExport: false, canSeeMoney: false })
    expect(accessFor(findReport('agents')!, agent)).toMatchObject({ allowed: true, userId: 'a1' })
    expect(accessFor(findReport('ads')!, agent).allowed).toBe(false)
    expect(accessFor(findReport('spending')!, agent).allowed).toBe(false)
    const menu = menuFor(agent)
    expect(menu.map((m) => m.key)).toEqual(['all', 'leads', 'agents', 'sales', 'guide'])
    expect(menu.every((m) => m.exports.length === 0)).toBe(true)
    expect(menu[0].title).toBe('My report')
  })

  it('a viewer is treated like an agent: own numbers only', () => {
    expect(accessFor(findReport('all')!, viewer)).toMatchObject({ allowed: true, userId: 'v1', canExport: false })
  })

  it('a supervisor sees the team and may export, spending yes, ad money no', () => {
    expect(accessFor(findReport('leads')!, supervisor)).toMatchObject({ allowed: true, userId: null, canExport: true, canSeeMoney: false })
    expect(accessFor(findReport('spending')!, supervisor).allowed).toBe(true)
    expect(accessFor(findReport('ads')!, supervisor).allowed).toBe(false)
  })

  it('an admin sees everything, money included, with all three exports', () => {
    const menu = menuFor(admin)
    expect(menu.map((m) => m.key)).toEqual(['all', 'leads', 'agents', 'ads', 'sales', 'spending', 'campaigns', 'guide'])
    expect(menu.every((m) => m.exports.join(',') === 'pdf,xlsx,pptx')).toBe(true)
    expect(accessFor(findReport('ads')!, admin)).toMatchObject({ allowed: true, userId: null, canSeeMoney: true })
  })

  it('an unknown report is not found', () => {
    expect(findReport('../etc')).toBeUndefined()
  })
})
