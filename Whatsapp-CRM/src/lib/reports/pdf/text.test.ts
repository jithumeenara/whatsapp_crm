import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import { drawnText, isRtlText, line, mirrorBrackets, paragraph, scriptOf, tokenize, visualOrder } from './text'

const newDoc = () => new PDFDocument({ size: 'A4', margin: 40 })

describe('the fontkit patch', () => {
  it('is applied: without it a Malayalam word ending in a virama crashes the PDF', () => {
    // scripts/patch-fontkit.cjs runs from npm's postinstall. If this fails, run it.
    for (const file of ['main.cjs', 'module.mjs']) {
      const src = fs.readFileSync(path.join(process.cwd(), 'node_modules', 'fontkit', 'dist', file), 'utf8')
      expect(src, file).toContain('PATCH: NULL anchor')
    }
  })
})

describe('scriptOf and tokenize', () => {
  it('knows the scripts it has fonts for', () => {
    expect(scriptOf('ല'.codePointAt(0)!)).toBe('malayalam')
    expect(scriptOf('ह'.codePointAt(0)!)).toBe('devanagari')
    expect(scriptOf('த'.codePointAt(0)!)).toBe('tamil')
    expect(scriptOf('త'.codePointAt(0)!)).toBe('telugu')
    expect(scriptOf('ಕ'.codePointAt(0)!)).toBe('kannada')
    expect(scriptOf('ক'.codePointAt(0)!)).toBe('bengali')
    expect(scriptOf('ع'.codePointAt(0)!)).toBe('arabic')
    expect(scriptOf('A'.codePointAt(0)!)).toBeNull()
  })

  it('cuts mixed text into words, each in its own script', () => {
    const { toks } = tokenize('Spend ചെലവ് 2026', 'ltr')
    const words = toks.filter((t) => !t.space).map((t) => [t.text, t.script])
    expect(words).toEqual([['Spend', 'latin'], ['ചെലവ്', 'malayalam'], ['2026', 'latin']])
  })

  it('reads Arabic right to left, and keeps numbers and Latin words in their own direction', () => {
    expect(isRtlText('تقرير المصروفات')).toBe(true)
    expect(isRtlText('Report')).toBe(false)
    const { toks } = tokenize('تقرير 2026-10-01 المصروفات', 'rtl')
    const visual = visualOrder(toks).filter((t) => !t.space).map((t) => t.text)
    // Logical order: تقرير, date, المصروفات. Drawn right to left, the first
    // word sits at the right, so the visual (left to right) list is reversed,
    // and the date is one piece with its digits in reading order.
    expect(visual).toEqual(['المصروفات', '2026-10-01', 'تقرير'])
  })
})

describe('brackets in right-to-left text', () => {
  it('are mirrored, because the font reverses the letters but not the brackets', () => {
    // Seen on a rendered page: "(تقديري)" came out as ")تقديري(".
    expect(mirrorBrackets('(تقديري)')).toBe(')تقديري(')
    expect(mirrorBrackets('[a]{b}<c>«d»')).toBe(']a[}b{>c<»d«')
    expect(mirrorBrackets('no brackets')).toBe('no brackets')
  })

  it('apply only to a token read right to left, never to Latin text, and never to the logical copy', () => {
    const rtl = tokenize('الذكاء الاصطناعي (تقديري)', 'rtl').toks
    const open = rtl.find((t) => t.text === '(')!
    const close = rtl.find((t) => t.text === ')')!
    expect(open.level % 2).toBe(1)
    expect(drawnText(open)).toBe(')') // drawn as its pair, so it still faces the word
    expect(drawnText(close)).toBe('(')
    expect(open.text).toBe('(') // what screen readers and copy get
    const ltr = tokenize('Spend (estimated)', 'ltr').toks
    for (const t of ltr) expect(drawnText(t)).toBe(t.text)
  })
})

describe('line and paragraph', () => {
  it('draws every supported language without throwing, and reports a width', () => {
    const doc = newDoc()
    for (const text of [
      'Spending report', 'ലീഡ് റിപ്പോർട്ട് ചെലവ് സംഗ്രഹം', 'व्यय सारांश रिपोर्ट', 'செலவு அறிக்கை',
      'ఖర్చు నివేదిక', 'ವೆಚ್ಚ ವರದಿ', 'ব্যয় প্রতিবেদন', 'تقرير المصروفات',
    ]) {
      expect(line(doc, text, 40, 40, { size: 10 })).toBeGreaterThan(0)
    }
  })

  it('cuts a long line to its box with an ellipsis', () => {
    const doc = newDoc()
    const w = line(doc, 'A very long business name that cannot possibly fit in a narrow column', 40, 40, { size: 10, width: 80 })
    expect(w).toBeLessThanOrEqual(80)
  })

  it('wraps a paragraph inside its width and returns where it ended', () => {
    const doc = newDoc()
    const text = 'All amounts are in the business currency and cover the chosen period. '.repeat(4)
    const end = paragraph(doc, text, 40, 100, 200, { size: 9 })
    expect(end).toBeGreaterThan(100 + 9 * 2) // several lines
    const wide = paragraph(newDoc(), text, 40, 100, 5000, { size: 9 })
    expect(wide).toBeLessThan(end)
  })

  it('wraps Arabic and Malayalam paragraphs too', () => {
    for (const text of ['تقرير المصروفات الشهري يوضح إجمالي الإنفاق على الرسائل والذكاء الاصطناعي خلال الفترة. '.repeat(3), 'എല്ലാ തുകകളും ബിസിനസ് കറൻസിയിലാണ്, തിരഞ്ഞെടുത്ത കാലയളവിലെ കണക്കുകൾ. '.repeat(3)]) {
      expect(paragraph(newDoc(), text, 40, 100, 200, { size: 9 })).toBeGreaterThan(100 + 9 * 2)
    }
  })
})
