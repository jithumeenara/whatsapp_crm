import { describe, it, expect } from 'vitest'
import { markupToHtml, markupToPlain, parseInline } from './markup'

describe('email markup', () => {
  it('formats bold, italic and underline', () => {
    expect(markupToHtml('**Hi** *there* __now__')).toBe(
      '<p style="margin:0 0 12px"><strong>Hi</strong> <em>there</em> <u>now</u></p>',
    )
  })

  it('makes bullet and numbered lists', () => {
    const html = markupToHtml('Fees:\n- Basic\n- Advanced\n1. Apply\n2. Pay')
    expect(html).toContain('<ul style="margin:0 0 12px;padding-left:24px"><li>Basic</li><li>Advanced</li></ul>')
    expect(html).toContain('<ol style="margin:0 0 12px;padding-left:24px"><li>Apply</li><li>Pay</li></ol>')
  })

  it('never lets markup through — tags, scripts and attributes stay text', () => {
    const html = markupToHtml('<script>alert(1)</script> **<img src=x onerror=alert(1)>**')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps line breaks inside a paragraph', () => {
    expect(markupToHtml('a\nb')).toBe('<p style="margin:0 0 12px">a<br>b</p>')
  })

  it('leaves arithmetic and unclosed markers alone', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }])
    expect(parseInline('**open')).toEqual([{ text: '**open' }])
  })

  it('gives a readable plain-text version', () => {
    expect(markupToPlain('**Dear** Anu,\n- one\n- two\n1. first')).toBe('Dear Anu,\n• one\n• two\n1. first')
  })
})
