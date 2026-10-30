import { describe, expect, it } from 'vitest'
import { canActOnMember } from './roles'

describe('canActOnMember', () => {
  it('owner acts on everyone but the owner', () => {
    for (const t of ['admin', 'supervisor', 'agent', 'viewer'] as const) expect(canActOnMember('owner', t)).toBe(true)
    expect(canActOnMember('owner', 'owner')).toBe(false)
  })
  it('admin acts only below admin', () => {
    expect(canActOnMember('admin', 'admin')).toBe(false)
    expect(canActOnMember('admin', 'owner')).toBe(false)
    for (const t of ['supervisor', 'agent', 'viewer'] as const) expect(canActOnMember('admin', t)).toBe(true)
  })
  it('nobody below admin acts on anyone', () => {
    for (const a of ['supervisor', 'agent', 'viewer'] as const) expect(canActOnMember(a, 'viewer')).toBe(false)
  })
})
