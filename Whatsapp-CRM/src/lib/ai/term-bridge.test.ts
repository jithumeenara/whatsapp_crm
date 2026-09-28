import { describe, it, expect } from 'vitest'
import { englishFor, monthOf, normalizeMalayalam } from './term-bridge'
import { selectRelevantContext } from './knowledge'

const ZWJ = String.fromCharCode(0x200d)

describe('months in English and Malayalam', () => {
  it('reads a month however it is written', () => {
    expect(monthOf('October')).toBe(10)
    expect(monthOf('oct')).toBe(10)
    expect(monthOf('ഒക്ടോബർ')).toBe(10)
    expect(monthOf('ഒക്ടോബറിൽ')).toBe(10)
    expect(monthOf('ജൂലൈ')).toBe(7)
    expect(monthOf('ജൂണിൽ')).toBe(6)
    expect(monthOf('ഏപ്രിലിൽ')).toBe(4)
  })

  it('reads the old keyboard spelling of a chillu', () => {
    // "ഒക്ടോബര്‍": ra + virama + zero-width joiner instead of "ർ".
    const old = 'ഒക്ടോബര' + String.fromCharCode(0x0d4d) + ZWJ
    expect(normalizeMalayalam(old)).toBe('ഒക്ടോബർ')
    expect(monthOf(old)).toBe(10)
  })

  it('does not read ordinary words as months', () => {
    expect(monthOf('മെയിൽ')).toBeNull() // mail
    expect(monthOf('training')).toBeNull()
    expect(monthOf('marketing')).toBeNull()
  })
})

describe('English words written in Malayalam', () => {
  it('bridges common words, with endings, across industries', () => {
    expect(englishFor('ഫീസ്')).toContain('fee')
    expect(englishFor('ട്രെയിനിങ്ങിൽ')).toContain('training')
    expect(englishFor('ഡോക്ടറെ')).toContain('doctor')
    expect(englishFor('ഡെലിവറി')).toContain('delivery')
    expect(englishFor('ഒക്ടോബറിൽ')).toContain('october')
    expect(englishFor('fee')).toEqual([])
  })

  it('lets a Malayalam question find English knowledge', async () => {
    const docs = [
      { id: 'doctors', title: 'Doctors', content: 'Doctor: Dr. Anil Kumar\nDepartment: Cardiology\nOP days: Monday, Thursday' },
      { id: 'delivery', title: 'Delivery', content: 'Delivery is free above Rs 500 within the city.' },
    ]
    const selected = await selectRelevantContext('കാർഡിയോളജി ഡോക്ടർ ഏതൊക്കെ ദിവസം', [], docs, { maxDocChunks: 1 })
    expect(selected.documentChunks[0]?.sourceId).toBe('doctors')
  })
})
