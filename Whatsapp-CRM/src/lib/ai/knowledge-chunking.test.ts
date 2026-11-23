import { describe, expect, it } from 'vitest'
import { chunkDocument, splitLongParagraph } from './knowledge'

/**
 * Bug: a long paragraph was cut every 800 characters wherever that fell,
 * so a fee or a date could be split across two chunks and neither half
 * matched the question. Long paragraphs are now cut at sentence ends,
 * with the previous sentence repeated; short paragraphs are unchanged so
 * their saved embeddings are still found.
 */

const sentence = (i: number) => `Item ${i} costs Rs ${1000 + i} and is available every weekday from nine to five.`

describe('splitLongParagraph', () => {
  const para = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ')

  it('never cuts inside a sentence', () => {
    const pieces = splitLongParagraph(para, 800)
    expect(pieces.length).toBeGreaterThan(1)
    for (const p of pieces) {
      expect(p.trim().endsWith('.')).toBe(true)
      expect(p.startsWith('Item ')).toBe(true)
    }
  })

  it('repeats the last sentence of a piece at the start of the next', () => {
    const pieces = splitLongParagraph(para, 800)
    for (let i = 1; i < pieces.length; i++) {
      const prevLast = pieces[i - 1].split(/(?<=\.)\s+/).pop()!
      expect(pieces[i].startsWith(prevLast)).toBe(true)
    }
  })

  it('keeps every word: nothing is dropped', () => {
    const pieces = splitLongParagraph(para, 800)
    for (let i = 0; i < 30; i++) expect(pieces.some((p) => p.includes(sentence(i)))).toBe(true)
  })

  it('a short heading line opens every later piece', () => {
    const withHeading = `Refund policy\n${para}`
    const pieces = splitLongParagraph(withHeading, 800)
    for (const p of pieces) expect(p.startsWith('Refund policy')).toBe(true)
  })

  it('a single sentence longer than a chunk is still cut by length', () => {
    const long = 'x'.repeat(2000)
    const pieces = splitLongParagraph(long, 800)
    expect(pieces.join('')).toBe(long)
  })
})

describe('chunkDocument', () => {
  it('paragraphs that already fit are unchanged (their embeddings stay valid)', () => {
    const doc = { id: 'd1', title: 'Hours', content: 'Open 9 to 5.\n\nClosed on Sunday.' }
    expect(chunkDocument(doc).map((c) => c.text)).toEqual(['Open 9 to 5.', 'Closed on Sunday.'])
  })
})
