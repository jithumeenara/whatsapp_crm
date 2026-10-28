import { describe, expect, it } from 'vitest'
import { MAX_LISTS, listIdsOf } from './list-audience'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('saved-list audience — one list or several', () => {
  it('reads the old single listId and the new listIds alike', () => {
    expect(listIdsOf({ listId: A })).toEqual([A])
    expect(listIdsOf({ listIds: [A, B] })).toEqual([A, B])
    expect(listIdsOf({ listIds: [A], listId: B })).toEqual([A, B])
  })

  it('each list once, ids only, at most 20', () => {
    expect(listIdsOf({ listIds: [A, A.toUpperCase(), B], listId: A })).toEqual([A, B])
    expect(listIdsOf({ listIds: ['x', 42, null, { id: A }] })).toEqual([])
    expect(listIdsOf({ listIds: 'not-a-list' })).toEqual([])
    expect(listIdsOf(null)).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(listIdsOf({ listIds: many })).toHaveLength(MAX_LISTS)
  })
})
