import { describe, expect, it } from 'vitest'
import { nameDiffers, nameUpdateFor } from './excel-row'

describe('broadcast Excel — names of numbers already in the CRM', () => {
  it('keeps the saved name unless the file’s name was chosen', () => {
    expect(nameUpdateFor('Biju Kumar', { name: 'Kollengode Bank' })).toBeNull()
    expect(nameUpdateFor('Biju Kumar', { name: 'Kollengode Bank', nameChoice: 'saved' })).toBeNull()
    expect(nameUpdateFor('Biju Kumar', { name: 'Kollengode Bank', nameChoice: 'file' })).toBe('Kollengode Bank')
  })

  it('a blank saved name takes the file’s; a number-only file changes nothing', () => {
    expect(nameUpdateFor(null, { name: '  Anu  Thomas ' })).toBe('Anu Thomas')
    expect(nameUpdateFor('Biju', { name: '' })).toBeNull()
    expect(nameUpdateFor('Biju', {})).toBeNull()
  })

  it('the same name in other case or spacing is not a difference', () => {
    expect(nameDiffers('Anu Thomas', 'anu  thomas')).toBe(false)
    expect(nameUpdateFor('Anu Thomas', { name: 'ANU THOMAS', nameChoice: 'file' })).toBeNull()
    expect(nameDiffers('Anu', 'Biju')).toBe(true)
    expect(nameDiffers('', 'Biju')).toBe(false)
  })

  it('only a string name, capped', () => {
    expect(nameUpdateFor(null, { name: 42 })).toBeNull()
    expect(nameUpdateFor(null, { name: 'x'.repeat(300) })?.length).toBe(100)
    expect(nameUpdateFor('A', { name: 'B', nameChoice: 'FILE' })).toBeNull()
  })
})
