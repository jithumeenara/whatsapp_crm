import { describe, expect, it } from 'vitest'
import { conditionsFromConfig, normaliseConditions, rowForCreate } from './contact-rows'

const fields = [
  { field_key: 'reg_id', label: 'Registration ID', field_type: 'text' },
  { field_key: 'whatsapp_no', label: 'Whatsapp no', field_type: 'text' },
  { field_key: 'email', label: 'Email', field_type: 'email' },
  { field_key: 'status', label: 'Status', field_type: 'select' },
  { field_key: 'pin', label: 'PIN', field_type: 'password' },
]

describe('finding any row by your own conditions', () => {
  it('accepts conditions on any searchable column', () => {
    const r = normaliseConditions(fields, [
      { field_key: 'reg_id', op: 'equals', value: ' R-104 ' },
      { field_key: 'status', op: 'not_empty' },
    ], false)
    expect(r).toEqual({ conditions: [{ field_key: 'reg_id', op: 'equals', value: 'R-104' }, { field_key: 'status', op: 'not_empty', value: '' }], nothing: false })
  })

  it('refuses unknown columns, secret columns and unknown comparisons', () => {
    expect(normaliseConditions(fields, [{ field_key: 'nope', op: 'equals', value: 'x' }], false)).toHaveProperty('error')
    expect(normaliseConditions(fields, [{ field_key: 'pin', op: 'equals', value: '1' }], false)).toHaveProperty('error')
    expect(normaliseConditions(fields, [{ field_key: 'reg_id', op: 'regex' as never, value: '.*' }], false)).toHaveProperty('error')
  })

  it('never changes the whole table: no condition needs "only this chat"', () => {
    expect(normaliseConditions(fields, [], false)).toHaveProperty('error')
    expect(normaliseConditions(fields, [], true)).toEqual({ conditions: [], nothing: false })
  })

  it('an empty value (variable never filled) or a short number matches nothing, not everything', () => {
    expect(normaliseConditions(fields, [{ field_key: 'reg_id', op: 'equals', value: '' }], false)).toMatchObject({ nothing: true })
    expect(normaliseConditions(fields, [{ field_key: 'whatsapp_no', op: 'phone', value: '43668' }], false)).toMatchObject({ nothing: true })
    expect(normaliseConditions(fields, [{ field_key: 'whatsapp_no', op: 'phone', value: '+91 94950 43668' }], false)).toMatchObject({ nothing: false })
  })
})

describe('a new row when nothing matches', () => {
  it('takes what the conditions say, then the columns being set', () => {
    expect(rowForCreate(
      [{ field_key: 'reg_id', op: 'equals', value: 'R-104' }, { field_key: 'status', op: 'not_empty', value: '' }],
      { status: 'Confirmed' },
    )).toEqual({ reg_id: 'R-104', status: 'Confirmed' })
  })
})

describe('saved step config', () => {
  it('reads the first version (one phone column) as "column = chatting number"', () => {
    expect(conditionsFromConfig({ match_field: 'whatsapp_no' })).toEqual([{ field_key: 'whatsapp_no', op: 'phone', value: '{{contact.phone}}' }])
  })
  it('reads custom conditions, defaulting an unknown comparison to equals', () => {
    expect(conditionsFromConfig({ conditions: [{ field_key: 'reg_id', op: 'weird', value: '{{vars.reg}}' }] }))
      .toEqual([{ field_key: 'reg_id', op: 'equals', value: '{{vars.reg}}' }])
  })
})
