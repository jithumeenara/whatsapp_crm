import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { buildFilterChain } from './webhook-handler'

/**
 * Month → Programme → labels. The label is filtered by Programme; Programme
 * is filtered by Month. A programme of the same name runs in September and
 * November, so the label must be filtered by Month too, or September's
 * details appear for a November choice.
 */
const TABLE = 'training'
const comps = [
  { type: 'Dropdown', name: 'month', _source_table_id: TABLE, _source_field_key: 'month', _filter_trigger: true },
  {
    type: 'Dropdown', name: 'programme', _source_table_id: TABLE, _source_field_key: 'training_programe',
    _filter_by_field: 'month', _filter_form_name: 'month', _filter_trigger: true,
  },
  {
    type: 'TextLabel', name: 'target', _source_table_id: TABLE, _source_field_key: 'target_group',
    _filter_by_field: 'training_programe', _filter_form_name: 'programme',
  },
]

describe('buildFilterChain', () => {
  it('carries the month a programme was filtered by down to the label', () => {
    const chain = buildFilterChain(comps, TABLE, 'programme', { month: 'november', programme: 'stp' }, 'programme', 'stp')
    expect(chain).toEqual([{ field: 'month', value: 'november' }])
  })

  it('uses the value just picked when the ancestor is the trigger', () => {
    const chain = buildFilterChain(comps, TABLE, 'programme', { month: '' }, 'month', 'november')
    expect(chain).toEqual([{ field: 'month', value: 'november' }])
  })

  it('stops where an ancestor has no value yet', () => {
    expect(buildFilterChain(comps, TABLE, 'programme', { programme: 'stp' }, null, null)).toEqual([])
  })

  it('ignores a parent that reads a different table', () => {
    expect(buildFilterChain(comps, 'other', 'programme', { month: 'november' }, null, null)).toEqual([])
  })

  it('has nothing to add for a parent that is not itself filtered', () => {
    expect(buildFilterChain(comps, TABLE, 'month', { month: 'november' }, null, null)).toEqual([])
  })

  it('does not loop on a circular configuration', () => {
    const loop = [
      { name: 'a', _source_table_id: TABLE, _filter_by_field: 'b', _filter_form_name: 'b' },
      { name: 'b', _source_table_id: TABLE, _filter_by_field: 'a', _filter_form_name: 'a' },
    ]
    expect(buildFilterChain(loop, TABLE, 'a', { a: 'x', b: 'y' }, null, null)).toEqual([{ field: 'b', value: 'y' }])
  })
})
