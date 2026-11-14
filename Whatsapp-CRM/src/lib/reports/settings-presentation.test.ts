import { describe, expect, it } from 'vitest'
import { parsePresentationSettings, validatePresentationSettings } from './settings'

/** The slides' brand colour and category name: only safe values are ever kept. */
describe('presentation settings', () => {
  it('keeps a six-digit colour (with or without #) and a capped category name', () => {
    expect(parsePresentationSettings({ brandColor: '#8B0A5C', categoryLabel: '  Speciality  ' })).toEqual({ brandColor: '8b0a5c', categoryLabel: 'Speciality' })
    expect(parsePresentationSettings({ brandColor: '8b0a5c' }).brandColor).toBe('8b0a5c')
  })

  it('drops anything that is not a plain colour, so nothing odd reaches a slide', () => {
    for (const bad of ['red', '#fff', '8b0a5c00', 'url(x)', '"><svg>', 123, null]) {
      expect(parsePresentationSettings({ brandColor: bad }).brandColor, String(bad)).toBeNull()
    }
    expect(parsePresentationSettings(null)).toEqual({ brandColor: null, categoryLabel: null })
  })

  it('refuses a bad colour or a long name when saving, with plain words', () => {
    expect(validatePresentationSettings({ brandColor: 'blue' })).toEqual({ ok: false, error: 'The brand colour must be six hex digits, like #7a1f5c.' })
    expect(validatePresentationSettings({ categoryLabel: 'x'.repeat(41) }).ok).toBe(false)
    expect(validatePresentationSettings({ brandColor: '#7a1f5c', categoryLabel: 'Course' })).toEqual({ ok: true, settings: { brandColor: '7a1f5c', categoryLabel: 'Course' } })
    expect(validatePresentationSettings({})).toEqual({ ok: true, settings: { brandColor: null, categoryLabel: null } })
  })
})
