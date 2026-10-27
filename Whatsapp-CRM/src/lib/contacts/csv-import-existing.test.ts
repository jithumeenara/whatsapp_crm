import { describe, expect, it } from 'vitest'
import { cleanImportRow, phoneKey, planExistingUpdate } from './csv-import'

const bank = { name: 'Kollengode Bank', company: null, email: null, archived: false }
const row = { phone: '9447012345', name: 'Biju Kumar', email: 'biju@example.com', company: undefined }

describe('importing a number that is already a contact', () => {
  it('skip changes nothing', () => {
    expect(planExistingUpdate(bank, row, 'skip')).toBeNull()
  })

  it('fill only fills empty fields — the name stays', () => {
    expect(planExistingUpdate(bank, row, 'fill')).toEqual({
      patch: { email: 'biju@example.com' },
      note: 'Email: — → biju@example.com',
    })
  })

  it("name takes the file's name", () => {
    expect(planExistingUpdate(bank, row, 'name')?.patch).toEqual({ email: 'biju@example.com', name: 'Biju Kumar' })
  })

  it("name_company: the old name (a business name) moves to company, the file's name becomes the name", () => {
    const plan = planExistingUpdate(bank, row, 'name_company')
    expect(plan?.patch).toEqual({ email: 'biju@example.com', name: 'Biju Kumar', company: 'Kollengode Bank' })
    expect(plan?.note).toContain('Company: — → Kollengode Bank')
  })

  it('never overwrites a company that is already there', () => {
    const plan = planExistingUpdate({ ...bank, company: 'KASCB' }, row, 'name_company')
    expect(plan?.patch.company).toBeUndefined()
  })

  it('never overwrites an email that is already there', () => {
    expect(planExistingUpdate({ ...bank, email: 'old@x.in' }, row, 'fill')).toBeNull()
  })

  it('a number with and without the country code is the same contact', () => {
    expect(phoneKey('+91 98765 43210')).toBe(phoneKey('9876543210'))
  })

  it('the server accepts only the four choices', () => {
    expect(cleanImportRow({ phone: '9876543210', onExisting: 'name_company' })?.onExisting).toBe('name_company')
    expect(cleanImportRow({ phone: '9876543210', onExisting: 'delete_all' })?.onExisting).toBeUndefined()
  })
})
