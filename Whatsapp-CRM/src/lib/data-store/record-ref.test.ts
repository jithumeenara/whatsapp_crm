import { describe, expect, it } from 'vitest'
import { plainRef, refMatches } from './record-ref'

const row = { id: '2626de7e-1111-4111-8111-111111111111', batch_id: null, public_ref: 'QX3J-XQNM-VT67' }

describe('finding a record by the reference a person quotes', () => {
  it('with the business’s prefix, dashes, spaces or lower case', () => {
    expect(refMatches(row, 'REG-QX3J-XQNM-VT67')).toBe(true)
    expect(refMatches(row, 'qx3j xqnm vt67')).toBe(true)
    expect(refMatches(row, 'XQNM')).toBe(true)
  })

  it('forgives look-alike characters read out on the phone', () => {
    expect(plainRef('o-I-l')).toBe('011')
    expect(refMatches({ ...row, public_ref: 'A0B1-C0D1-E0F1' }, 'aObI-cOdl-eOfI')).toBe(true)
  })

  it('a short or different query finds nothing', () => {
    expect(refMatches(row, 'QX3')).toBe(false)
    expect(refMatches(row, 'ZZZZ-ZZZZ-ZZZZ')).toBe(false)
  })

  it('references given before migration 151 still find their rows: the id, or the group’s id', () => {
    expect(refMatches({ ...row, public_ref: null }, '2626DE7E')).toBe(true)
    expect(refMatches({ ...row, public_ref: null }, 'REG-2626DE7E')).toBe(true)
    expect(refMatches({ id: row.id, batch_id: 'aaaaaaaa-0000-4000-8000-000000000000', public_ref: null }, 'AAAAAAAA')).toBe(true)
    expect(refMatches({ ...row, public_ref: null }, '2626')).toBe(false)
  })
})
