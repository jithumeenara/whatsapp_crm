import { describe, expect, it } from 'vitest'
import { REPORT_LANGUAGES } from '@/lib/countries'
import { en } from './en'
import { DICTIONARIES, dictionaryFor, isRtlLanguage, t } from './index'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('report dictionaries', () => {
  it('has a dictionary for every language Settings offers, and offers nothing without one', () => {
    for (const l of REPORT_LANGUAGES) expect(DICTIONARIES[l.code], l.code).toBeDefined()
    for (const code of Object.keys(DICTIONARIES)) {
      expect(REPORT_LANGUAGES.some((l) => l.code === code), `${code} has a dictionary but is not offered`).toBe(true)
    }
  })

  it('gives every key in every language, with the same placeholders, and no empty text', () => {
    const keys = Object.keys(en) as Array<keyof typeof en>
    for (const [code, dict] of Object.entries(DICTIONARIES)) {
      expect(Object.keys(dict).sort(), code).toEqual([...keys].sort())
      for (const key of keys) {
        expect(dict[key].trim().length, `${code}.${key} is empty`).toBeGreaterThan(0)
        expect(placeholders(dict[key]), `${code}.${key}`).toEqual(placeholders(en[key]))
      }
    }
  })

  it('actually translates: no language other than English repeats the English text for its headings', () => {
    for (const [code, dict] of Object.entries(DICTIONARIES)) {
      if (code === 'en') continue
      expect(dict.title, code).not.toBe(en.title)
      expect(dict.kTotal, code).not.toBe(en.kTotal)
    }
  })

  it('marks right-to-left languages', () => {
    expect(isRtlLanguage('ar')).toBe(true)
    for (const code of ['en', 'ml', 'hi', 'ta', 'te', 'kn', 'bn']) expect(isRtlLanguage(code)).toBe(false)
    for (const l of REPORT_LANGUAGES) expect(isRtlLanguage(l.code), l.code).toBe(l.rtl)
  })
})

describe('t', () => {
  it('fills placeholders', () => {
    expect(t('en', 'pageOf', { n: 2, total: 5 })).toBe('Page 2 of 5')
    expect(t('ml', 'pageOf', { n: 2, total: 5 })).toContain('2')
  })

  it('falls back to English for a language or code it does not know, never throws', () => {
    expect(t('xx', 'title')).toBe('Spending report')
    expect(t(null, 'title')).toBe('Spending report')
    expect(t('../../etc/passwd', 'title')).toBe('Spending report')
    expect(dictionaryFor(undefined)).toBe(en)
  })

  it('leaves a placeholder it was not given, rather than printing "undefined"', () => {
    expect(t('en', 'pageOf', { n: 1 })).toBe('Page 1 of {total}')
  })
})
