import { describe, expect, it } from 'vitest'
import { containsPattern, messageSnippet, splitOnMatch } from './message-search'

describe('inbox message search helpers', () => {
  it('treats %, _ and backslash as ordinary characters', () => {
    expect(containsPattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%')
  })

  it('keeps a short message whole and on one line', () => {
    expect(messageSnippet('Fee\n  details', 'fee')).toBe('Fee details')
    expect(messageSnippet(null, 'fee')).toBe('')
  })

  it('shows the part of a long message around the match', () => {
    const s = messageSnippet(`${'a '.repeat(100)}the fee is due ${'b '.repeat(100)}`, 'FEE')
    expect(s).toContain('the fee is due')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })

  it('drops markup from email bodies', () => {
    expect(messageSnippet('<p>Hello <b>there</b></p>', 'there')).toBe('Hello there')
  })

  it('marks every match, whatever the case, and works for Malayalam', () => {
    expect(splitOnMatch('Fee and FEE', 'fee')).toEqual([
      { text: 'Fee', match: true },
      { text: ' and ', match: false },
      { text: 'FEE', match: true },
    ])
    expect(splitOnMatch('പരിശീലനം ഫീസ്', 'ഫീസ്')).toEqual([
      { text: 'പരിശീലനം ', match: false },
      { text: 'ഫീസ്', match: true },
    ])
  })

  it('does not treat the query as a pattern', () => {
    expect(splitOnMatch('a.c abc', 'a.c')).toEqual([
      { text: 'a.c', match: true },
      { text: ' abc', match: false },
    ])
  })
})
