import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
import { isFilterableField, phoneColumns, tableRuleError } from './table-audience'

const T = '00000000-0000-4000-8000-000000000001'

describe('broadcast "From a table" rules', () => {
  it('needs a table, a column, a rule and — for is / is not / contains — a value', () => {
    expect(tableRuleError(undefined)).toMatch(/table/)
    expect(tableRuleError({ tableId: 'nope' })).toMatch(/table/)
    expect(tableRuleError({ tableId: T })).toMatch(/column/)
    expect(tableRuleError({ tableId: T, fieldKey: 'fee_status', operator: 'like' as never })).toMatch(/compare/)
    expect(tableRuleError({ tableId: T, fieldKey: 'fee_status', operator: 'is', value: '  ' })).toMatch(/value/)
    expect(tableRuleError({ tableId: T, fieldKey: 'fee_status', operator: 'is', value: 'x'.repeat(201) })).toMatch(/too long/)
    expect(tableRuleError({ tableId: T, fieldKey: 'fee_status', operator: 'is', value: 'Not paid' })).toBeNull()
    expect(tableRuleError({ tableId: T, fieldKey: 'fee_status', operator: 'is_empty' })).toBeNull()
  })

  it('a column name cannot carry SQL', () => {
    expect(tableRuleError({ tableId: T, fieldKey: "x') OR 1=1 --", operator: 'is_empty' })).toMatch(/column/)
  })

  it('never filters on secrets, files or layout', () => {
    expect(isFilterableField('select')).toBe(true)
    for (const t of ['password', 'file', 'image', 'signature', 'section_header', 'html_block', 'relation']) {
      expect(isFilterableField(t)).toBe(false)
    }
  })

  it('takes people from phone columns — never an Aadhaar or account number', () => {
    const fields = [
      { field_key: 'name_of_participant', label: 'Name', field_type: 'text' },
      { field_key: 'whatsapp_no', label: 'WhatsApp No', field_type: 'text' },
      { field_key: 'aaadhaar_no', label: 'Aadhaar No', field_type: 'number' },
      { field_key: 'account_number', label: 'Bank account number', field_type: 'text' },
    ]
    expect(phoneColumns(fields)).toEqual(['whatsapp_no'])
    // A phone-type column does not hide a "WhatsApp No" text column beside it.
    expect(phoneColumns([{ field_key: 'mob', label: 'Mobile', field_type: 'phone' }, ...fields])).toEqual(['mob', 'whatsapp_no'])
    expect(phoneColumns([{ field_key: 'a', label: 'A', field_type: 'text' }])).toBeNull()
  })
})
