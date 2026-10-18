import { describe, expect, it } from 'vitest'
import { toggleList, toggleWrap } from './format-edit'

const sel = (v: string, word: string) => {
  const s = v.indexOf(word)
  return [s, s + word.length] as const
}

describe('bold / italic / strike buttons', () => {
  it('wraps the selection', () => {
    const v = 'Your training starts tomorrow'
    expect(toggleWrap(v, ...sel(v, 'tomorrow'), '*').value).toBe('Your training starts *tomorrow*')
    expect(toggleWrap(v, ...sel(v, 'training'), '_').value).toBe('Your _training_ starts tomorrow')
    expect(toggleWrap(v, ...sel(v, 'Your'), '~').value).toBe('~Your~ training starts tomorrow')
  })

  it('pressed again, takes the formatting off — whether the stars are selected or not', () => {
    const v = 'Hi *Anu* there'
    expect(toggleWrap(v, ...sel(v, '*Anu*'), '*').value).toBe('Hi Anu there')
    expect(toggleWrap(v, ...sel(v, 'Anu'), '*').value).toBe('Hi Anu there')
  })

  it('keeps spaces outside the markers, as WhatsApp needs', () => {
    const v = 'Hi Anu there'
    expect(toggleWrap(v, 2, 7, '*').value).toBe('Hi *Anu* there')
  })

  it('works on Malayalam text', () => {
    const v = 'പരിശീലനം നാളെ തുടങ്ങും'
    expect(toggleWrap(v, ...sel(v, 'നാളെ'), '*').value).toBe('പരിശീലനം *നാളെ* തുടങ്ങും')
  })

  it('with nothing selected, puts the cursor between an empty pair', () => {
    expect(toggleWrap('Hi ', 3, 3, '*')).toEqual({ value: 'Hi **', start: 4, end: 4 })
  })
})

describe('numbered and bulleted list buttons', () => {
  const v = 'Bring:\nID card\nPhoto\n\nPen'

  it('numbers every selected line, skipping blank ones', () => {
    const r = toggleList(v, v.indexOf('ID'), v.length, 'numbered')
    expect(r.value).toBe('Bring:\n1. ID card\n2. Photo\n\n3. Pen')
  })

  it('bullets the line the cursor is on', () => {
    expect(toggleList(v, v.indexOf('Photo') + 2, v.indexOf('Photo') + 2, 'bulleted').value).toBe('Bring:\nID card\n- Photo\n\nPen')
  })

  it('pressed again, removes the numbers', () => {
    const numbered = 'Bring:\n1. ID card\n2. Photo'
    expect(toggleList(numbered, 7, numbered.length, 'numbered').value).toBe('Bring:\nID card\nPhoto')
  })

  it('switches bullets to numbers', () => {
    const bulleted = '- ID card\n- Photo'
    expect(toggleList(bulleted, 0, bulleted.length, 'numbered').value).toBe('1. ID card\n2. Photo')
  })
})
