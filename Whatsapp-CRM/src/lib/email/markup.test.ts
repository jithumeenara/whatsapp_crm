import { describe, it, expect } from 'vitest'
import { markupToHtml, markupToPlain, parseInline } from './markup'

describe('email markup', () => {
  it('formats bold, italic and underline', () => {
    expect(markupToHtml('**Hi** *there* __now__')).toBe(
      '<p style="margin:0 0 12px"><strong>Hi</strong> <em>there</em> <u>now</u></p>',
    )
  })

  it('links web addresses, bare or with their own words', () => {
    const html = markupToHtml('See [our fees](https://acsti.in/fees) or https://acsti.in/a__b__c.')
    expect(html).toContain(
      '<a href="https://acsti.in/fees" style="color:#0b57d0;text-decoration:underline" target="_blank" rel="noopener noreferrer">our fees</a>',
    )
    // Underscores inside an address are not formatting, and the full stop
    // after it is the sentence's.
    expect(html).toContain('>https://acsti.in/a__b__c</a>.')
    expect(html).not.toContain('<u>')
    expect(markupToPlain('See [our fees](https://acsti.in/fees)')).toBe('See our fees (https://acsti.in/fees)')
    expect(markupToHtml('**https://acsti.in**')).toContain('<a href="https://acsti.in/"')
  })

  it('never makes a link that could run something or break out of the tag', () => {
    const bad = markupToHtml('[x](javascript:alert(1)) javascript:alert(1) [y](https://a.com/"onmouseover="alert(1))')
    expect(bad).not.toContain('javascript:alert(1)"')
    expect(bad).not.toMatch(/href="javascript/i)
    expect(bad).not.toContain('"onmouseover')
    expect(markupToHtml('data:text/html,<script>alert(1)</script>')).not.toContain('<a')
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
