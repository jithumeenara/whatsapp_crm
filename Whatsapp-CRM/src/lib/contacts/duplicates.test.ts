import { describe, expect, it } from 'vitest'
import { findDuplicateGroups, type DupContact } from './duplicates'

const c = (id: string, over: Partial<DupContact> = {}): DupContact => ({
  id, name: null, phone: null, alternate_phone: null, email: null, created_at: '2026-01-01', ...over,
})

describe('finding duplicate contacts', () => {
  it('groups one number written differently', () => {
    const g = findDuplicateGroups([
      c('a', { phone: '+91 94950 43668', name: 'Anu' }),
      c('b', { phone: '9495043668' }),
      c('x', { phone: '+91 80000 00000' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].contacts.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(g[0].reasons).toEqual(['Same phone number'])
  })

  it('groups the same email in any case, and an alternate number', () => {
    const g = findDuplicateGroups([
      c('wa', { phone: '+919495043668', name: 'Anu' }),
      c('mail', { phone: 'email:anu@x.com', email: 'Anu@X.com' }),
      c('web', { phone: 'web:abc', email: 'anu@x.com', alternate_phone: '9495043668' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].contacts).toHaveLength(3)
    expect(g[0].reasons.sort()).toEqual(['Alternate number matches', 'Same email'])
  })

  it('never groups on the same name alone', () => {
    expect(findDuplicateGroups([c('a', { name: 'Anu', phone: '+919495043668' }), c('b', { name: 'Anu', phone: '+919400000000' })])).toEqual([])
  })

  it('never treats placeholders or long social ids as phone numbers', () => {
    expect(findDuplicateGroups([
      c('a', { phone: 'web:1234567890' }),
      c('b', { phone: 'web:1234567890x' }),
      c('ig1', { phone: '17841400000001234' }),
      c('ig2', { phone: '27841400000001234' }),
    ])).toEqual([])
  })

  it('suggests keeping the record with a real number and name first', () => {
    const g = findDuplicateGroups([
      c('mail', { phone: 'email:anu@x.com', email: 'anu@x.com', created_at: '2025-01-01' }),
      c('wa', { phone: '+919495043668', name: 'Anu', email: 'ANU@x.com', created_at: '2026-05-01' }),
    ])
    expect(g[0].contacts[0].id).toBe('wa')
  })
})
