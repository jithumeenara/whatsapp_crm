import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { guessFieldType } from './sheet-browse'
import { columnMapOf, suggestColumns } from './sheet-sync'

describe('guessing a sheet column type', () => {
  it('reads the header and the values', () => {
    expect(guessFieldType('Email', ['a@b.com']).type).toBe('email')
    expect(guessFieldType('Contact', ['a@b.com', 'c@d.in']).type).toBe('email')
    expect(guessFieldType('Mobile', ['98470 12345']).type).toBe('phone')
    expect(guessFieldType('Fee', ['1,200', '950']).type).toBe('number')
    expect(guessFieldType('Roll No', ['101', '102']).type).toBe('text')
    expect(guessFieldType('Joined', ['2026-10-01', '2026-09-30']).type).toBe('date')
    expect(guessFieldType('Site', ['https://x.com']).type).toBe('url')
    expect(guessFieldType('Name', ['Anu', 'Biju']).type).toBe('text')
  })

  it('makes a dropdown of a column with a few repeated values', () => {
    const vals = ['Kochi', 'Thrissur', 'Kochi', 'Kochi', 'Thrissur', 'Kollam', 'Kochi', 'Kollam']
    expect(guessFieldType('Branch', vals)).toEqual({ type: 'select', options: ['Kochi', 'Kollam', 'Thrissur'] })
  })
})

describe('mapping columns to a table', () => {
  it('uses a field with the same name, and suggests new fields for the rest', () => {
    const cols = suggestColumns(['Name', 'Phone', 'City'], [['Anu', '9847012345', 'Kochi']], [
      { field_key: 'name', label: 'Name', field_type: 'text' },
    ])
    expect(cols[0]).toEqual({ header: 'Name', target: 'name' })
    expect(cols[1]).toMatchObject({ header: 'Phone', target: 'new', type: 'phone' })
    expect(cols[2]).toMatchObject({ header: 'City', target: 'new', type: 'text' })
  })

  it('works for a table with no fields at all', () => {
    expect(suggestColumns(['A', 'B'], [], []).every((c) => c.target === 'new')).toBe(true)
  })

  it('reads a stored map and ignores anything else', () => {
    expect(columnMapOf({ Name: 'name', Skip: '', Bad: 3 })).toEqual({ Name: 'name', Skip: '' })
    expect(columnMapOf(null)).toBeNull()
    expect(columnMapOf(['x'])).toBeNull()
  })
})
