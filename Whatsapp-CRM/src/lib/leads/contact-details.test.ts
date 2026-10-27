import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
const { cleanContactDetails } = await import('./contact-details')

describe('New lead — gender, age and address', () => {
  it('keeps what is filled in, leaves blanks out', () => {
    expect(cleanContactDetails({ gender: 'female', age: ' 34 ', address: '  Kottayam\r\nKerala ' })).toEqual({ gender: 'female', age: '34', address: 'Kottayam\nKerala' })
    expect(cleanContactDetails({ gender: '', age: '', address: '   ' })).toEqual({})
    expect(cleanContactDetails({})).toEqual({})
    expect(cleanContactDetails({ age: 7 })).toEqual({ age: '7' })
  })

  it('refuses values the form never sends', () => {
    expect(cleanContactDetails({ gender: 'admin' })).toHaveProperty('error')
    expect(cleanContactDetails({ age: '121' })).toHaveProperty('error')
    expect(cleanContactDetails({ age: '-3' })).toHaveProperty('error')
    expect(cleanContactDetails({ age: '3.5' })).toHaveProperty('error')
    expect(cleanContactDetails({ address: 'x'.repeat(501) })).toHaveProperty('error')
    expect(cleanContactDetails({ address: { a: 1 } })).toEqual({})
  })
})

describe('editing a contact — gender, age and address', async () => {
  const { contactDetailsPatch } = await import('./contact-details')

  it('only the fields sent; an empty value clears', () => {
    expect(contactDetailsPatch({ name: 'x' })).toEqual({})
    expect(contactDetailsPatch({ age: '', address: '  ', gender: '' })).toEqual({ age: null, address: null, gender: null })
    expect(contactDetailsPatch({ age: '41', address: 'Kollam' })).toEqual({ age: 41, address: 'Kollam' })
    expect(contactDetailsPatch({ age: null })).toEqual({ age: null })
  })

  it('refuses what the database would refuse', () => {
    expect(contactDetailsPatch({ age: '200' })).toHaveProperty('error')
    expect(contactDetailsPatch({ gender: 'x' })).toHaveProperty('error')
    expect(contactDetailsPatch({ address: 'a'.repeat(501) })).toHaveProperty('error')
  })
})
