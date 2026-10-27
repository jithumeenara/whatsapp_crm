import { describe, expect, it } from 'vitest'
import { CONTACTS_TEMPLATE_CSV, cleanImportRow, parseContactsCsv } from './csv-import'

describe('contacts CSV import', () => {
  it('reads the template it offers for download', () => {
    const { rows, missingPhoneColumn } = parseContactsCsv(CONTACTS_TEMPLATE_CSV)
    expect(missingPhoneColumn).toBe(false)
    expect(rows.map((r) => [r.phone, r.name, r.status])).toEqual([
      ['+919876543210', 'Anu Thomas', 'ready'],
      ['+919447012345', 'Biju Kumar', 'ready'],
    ])
  })

  it("reads a file Excel saved, with its byte-order mark and its own header names", () => {
    const csv = '﻿Full Name,Mobile No,E-mail\r\n"Thomas, K",9876543210,THOMAS@Example.com\r\n'
    const { rows } = parseContactsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Thomas, K', phone: '9876543210', email: 'thomas@example.com', status: 'ready' })
  })

  it('marks a repeated number (with or without the country code) and a wrong number', () => {
    const csv = 'phone,name\n9876543210,A\n+91 98765 43210,B\nabc123,C\n,D\n'
    const { rows } = parseContactsCsv(csv)
    expect(rows.map((r) => r.status)).toEqual(['ready', 'duplicate', 'bad_phone', 'bad_phone'])
    expect(rows[1].line).toBe(3)
  })

  it('keeps a row with a bad email, without the email, and says so', () => {
    const { rows } = parseContactsCsv('phone,email\n9876543210,not-an-email\n')
    expect(rows[0]).toMatchObject({ status: 'ready', email: undefined })
    expect(rows[0].note).toMatch(/not valid/)
  })

  it('needs a phone column', () => {
    expect(parseContactsCsv('name,email\nA,a@b.co\n').missingPhoneColumn).toBe(true)
  })

  it('quoted quotes stay in the cell', () => {
    const { rows } = parseContactsCsv('phone,company\n9876543210,"The ""Best"" Shop"\n')
    expect(rows[0].company).toBe('The "Best" Shop')
  })

  it('the server checks each row again and keeps only known fields', () => {
    expect(cleanImportRow({ phone: 'x', name: 'A' })).toBeNull()
    expect(cleanImportRow({ phone: '9876543210', email: 'Bad', role: 'owner', account_id: 'other' })).toEqual({
      phone: '9876543210', name: undefined, email: undefined, company: undefined,
    })
    expect(cleanImportRow('nope')).toBeNull()
  })
})
