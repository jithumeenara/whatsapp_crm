import { describe, it, expect } from 'vitest'
import {
  copySources,
  isCopyPath,
  liveCopy,
  parseCopy,
  parseLanguages,
  pickLang,
  staleCopy,
  FORM_UI_WORDS,
  MAX_COPY_CHARS,
  MAX_COPY_ENTRIES,
} from './form-i18n'
import { parseFormConfig } from './public-form'
import { FORM_STRINGS, UI_TEXT_KEYS, formStrings } from '@/components/data/form-strings'

describe('form languages', () => {
  it('keeps known languages, never the main one twice, at most three more', () => {
    expect(parseLanguages({ main: 'ta', extra: ['en', 'ta', 'xx', 'en', 'hi', 'ar', 'kn'] })).toEqual({ main: 'ta', extra: ['en', 'hi', 'ar'] })
    expect(parseLanguages({ main: 'klingon', extra: 'ml' })).toEqual({ main: 'en', extra: [] })
  })

  it('a form saved before languages existed keeps English and Malayalam; a new choice is kept as made', () => {
    expect(parseFormConfig({ enabled: true }).languages).toEqual({ main: 'en', extra: ['ml'] })
    expect(parseFormConfig({ enabled: true, languages: { main: 'en', extra: [] } }).languages).toEqual({ main: 'en', extra: [] })
    expect(parseFormConfig({ languages: { main: 'hi', extra: ['ta'] } }).languages).toEqual({ main: 'hi', extra: ['ta'] })
  })

  it('reads only valid translations and known form words', () => {
    const copy = parseCopy({
      ta: { 'label:month': { t: '  மாதம் ', s: 'Month' }, 'bad path': { t: 'x', s: '' }, title: { t: '   ', s: 'T' }, 'opt:month:November': { t: 'நவம்பர்', s: 'November' } },
      en: { 'ui:submit': { t: 'Register', s: '' }, 'ui:madeUpWord': { t: 'x'.repeat(600), s: '' } },
      zz: { title: { t: 'x', s: 'y' } },
    })
    expect(copy.ta).toEqual({ 'label:month': { t: 'மாதம்', s: 'Month' }, 'opt:month:November': { t: 'நவம்பர்', s: 'November' } })
    expect(copy.en).toEqual({ 'ui:submit': { t: 'Register', s: '' } })
    expect(Object.keys(copy)).not.toContain('zz')
  })

  it('keeps a language’s translations when it becomes the main one, but the form shows the questions as written', () => {
    const copy = parseCopy({ ml: { 'label:month': { t: 'മാസം', s: 'Month' }, 'ui:submit': { t: 'അയയ്ക്കൂ', s: '' } } })
    expect(copy.ml?.['label:month']?.t).toBe('മാസം')
    const sources = [{ path: 'label:month', text: 'Month', where: 'Question' }]
    expect(liveCopy(copy, 'ml', sources, 'ml')).toEqual({ 'ui:submit': 'അയയ്ക്കൂ' })
    expect(liveCopy(copy, 'ml', sources, 'en')).toEqual({ 'label:month': 'മാസം', 'ui:submit': 'അയയ്ക്കൂ' })
  })

  it('caps all translations of one form together', () => {
    const block = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`label:q${i}`, { t: 'x'.repeat(600), s: 'y'.repeat(600) }]))
    const copy = parseCopy({ ml: block(500), hi: block(500), ta: block(500) })
    const chars = Object.values(copy).flatMap((b) => Object.entries(b ?? {})).reduce((n, [p, e]) => n + p.length + e.t.length + e.s.length, 0)
    expect(chars).toBeLessThanOrEqual(MAX_COPY_CHARS)
  })

  it('says when a limit cut something, and a reworded button is never what gets cut', () => {
    const full = Object.fromEntries(Array.from({ length: MAX_COPY_ENTRIES + 5 }, (_, i) => [`label:q${i}`, { t: 'x', s: 'y' }]))
    const report = { cut: false }
    const copy = parseCopy({ ml: { ...full, 'ui:submit': { t: 'അയയ്ക്കൂ', s: '' } } }, report)
    expect(report.cut).toBe(true)
    expect(copy.ml?.['ui:submit']?.t).toBe('അയയ്ക്കൂ')
    const fine = { cut: false }
    parseCopy({ ml: { 'label:a': { t: 'x', s: 'y' } } }, fine)
    expect(fine.cut).toBe(false)
  })

  it('an option with spaces around it is translated under its trimmed name, as the form looks it up', () => {
    const s = copySources({ title: 'T', intro: null, success: null, consent: null, groupLabel: null, fields: [{ key: 'month', label: 'Month', type: 'radio', options: ['November '] }] })
    expect(s.map((x) => x.path)).toContain('opt:month:November')
  })

  it('the list of words a business may reword matches the form’s words', () => {
    expect([...FORM_UI_WORDS].sort()).toEqual([...UI_TEXT_KEYS].sort())
  })

  it('caps how many translations one language keeps', () => {
    const block = Object.fromEntries(Array.from({ length: MAX_COPY_ENTRIES + 50 }, (_, i) => [`label:q${i}`, { t: 'x', s: 'y' }]))
    expect(Object.keys(parseCopy({ hi: block }).hi ?? {})).toHaveLength(MAX_COPY_ENTRIES)
  })
})

describe('what gets translated', () => {
  const sources = copySources({
    title: 'Training registration',
    intro: null,
    success: 'Thanks!',
    consent: null,
    groupLabel: 'Participant',
    fields: [
      { key: 'month', label: 'Month', type: 'radio', options: ['November', 'December'] },
      { key: 'programme', label: 'Training Programme', type: 'select', help: 'Pick one', options: ['STP- Sub Staff'] },
      { key: 'from_date', label: 'From Date', type: 'date' },
    ],
    values: { from_date: ['2026-11-04', '04/11/2026'], programme: ['STP- Sub Staff', 'Leadership'] },
  })
  const paths = sources.map((s) => s.path)

  it('lists the heading, each question, help, options and words filled in, in form order', () => {
    expect(paths).toEqual([
      'title', 'group',
      'label:month', 'opt:month:November', 'opt:month:December',
      'label:programme', 'help:programme', 'opt:programme:STP- Sub Staff', 'opt:programme:Leadership',
      'label:from_date',
      'success',
    ])
  })

  it('offers the confirmation’s own heading only when the business wrote one', () => {
    const base = { title: 'T', intro: null, success: null, consent: null, groupLabel: null, fields: [] }
    expect(copySources({ ...base, confirmTitle: 'Registration successful' }).map((s) => s.path)).toContain('ctitle')
    expect(copySources(base).map((s) => s.path)).not.toContain('ctitle')
    expect(isCopyPath('ctitle')).toBe(true)
  })

  it('never offers a date or a number for translating', () => {
    expect(paths.some((p) => p.includes('2026'))).toBe(false)
  })

  it('shows a translation only while its original is unchanged', () => {
    const copy = { ml: {
      'label:month': { t: 'മാസം', s: 'Month' },
      'label:programme': { t: 'പരിശീലനം', s: 'Programme' },
      'opt:month:November': { t: 'നവംബർ', s: 'November' },
      'ui:submit': { t: 'രജിസ്റ്റർ', s: '' },
      'label:gone': { t: 'x', s: 'Gone' },
    } }
    expect(liveCopy(copy, 'ml', sources)).toEqual({ 'label:month': 'മാസം', 'opt:month:November': 'നവംബർ', 'ui:submit': 'രജിസ്റ്റർ' })
    expect([...staleCopy(copy, 'ml', sources)]).toEqual(['label:programme'])
    expect(liveCopy(copy, 'ta', sources)).toEqual({})
  })
})

describe('the reader’s language', () => {
  const langs = { main: 'en' as const, extra: ['ml' as const, 'ar' as const] }
  it('takes ?lang= first, then the browser, only if the form offers it, else the main one', () => {
    expect(pickLang(langs, ['ar', 'ml-IN'])).toBe('ar')
    expect(pickLang(langs, ['ta', 'ml-IN', 'en'])).toBe('ml')
    expect(pickLang(langs, ['hi-IN', null])).toBe('en')
  })
})

describe('form words', () => {
  it('every language has every word, and a business may reword plain ones only', () => {
    for (const strings of Object.values(FORM_STRINGS)) {
      expect(Object.keys(strings).sort()).toEqual(Object.keys(FORM_STRINGS.en).sort())
    }
    expect(UI_TEXT_KEYS).toContain('submit')
    expect(UI_TEXT_KEYS).not.toContain('answered')
    const t = formStrings('ta', { 'ui:submit': 'பதிவு செய்', 'ui:answered': 'ignored' })
    expect(t.submit).toBe('பதிவு செய்')
    expect(typeof t.answered).toBe('function')
  })
})
