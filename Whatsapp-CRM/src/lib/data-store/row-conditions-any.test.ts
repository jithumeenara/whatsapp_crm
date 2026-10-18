import { describe, expect, it } from 'vitest'
import { normaliseConditions } from './contact-rows'

const fields = [
  { field_key: 'reg_id', label: 'Registration ID', field_type: 'text' },
  { field_key: 'whatsapp_no', label: 'Whatsapp no', field_type: 'text' },
]

describe('"any of these" conditions (OR)', () => {
  it('one condition that can match nothing does not stop the others', () => {
    const r = normaliseConditions(fields, [
      { field_key: 'reg_id', op: 'equals', value: '' },
      { field_key: 'whatsapp_no', op: 'phone', value: '+91 94950 43668' },
    ], false, 'any')
    expect(r).toMatchObject({ nothing: false })
    if ('conditions' in r) expect(r.conditions[0].never).toBe(true)
  })

  it('matches nothing only when every condition can match nothing', () => {
    expect(normaliseConditions(fields, [
      { field_key: 'reg_id', op: 'equals', value: '' },
      { field_key: 'whatsapp_no', op: 'phone', value: '123' },
    ], false, 'any')).toMatchObject({ nothing: true })
  })

  it('"all of these" still needs every one (the default)', () => {
    expect(normaliseConditions(fields, [
      { field_key: 'reg_id', op: 'equals', value: '' },
      { field_key: 'whatsapp_no', op: 'phone', value: '+91 94950 43668' },
    ], false)).toMatchObject({ nothing: true })
  })
})
