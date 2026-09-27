// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { editorHtmlFromMarkup, markupFromEditor } from './editor-dom'
import { markupToHtml } from './markup'

function fromHtml(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  return markupFromEditor(root)
}

describe('email editor ⇄ markup', () => {
  it('reads what Chrome builds: a bare first line, a div per line, <br> for a blank one', () => {
    expect(fromHtml('Hello Anu,<div><br></div><div><b>Fees</b> are <i>due</i> <u>today</u>.</div>')).toBe(
      'Hello Anu,\n\n**Fees** are *due* __today__.',
    )
  })

  it('reads the other spellings of bold, italic and underline', () => {
    expect(
      fromHtml(
        '<div><strong>a</strong> <em>b</em> <span style="font-weight: 700">c</span> <span style="font-style: italic">d</span> <span style="text-decoration: underline">e</span></div>',
      ),
    ).toBe('**a** *b* **c** *d* __e__')
  })

  it('keeps spaces outside the markers, and merges neighbours', () => {
    expect(fromHtml('<div><b>bold </b><b>text</b> end</div>')).toBe('**bold text** end')
  })

  it('reads bulleted and numbered lists, however they are nested', () => {
    expect(
      fromHtml('<div>Steps:</div><ol><li>Apply</li><li><b>Pay</b></li></ol><ul><li>one</li><li>two<ul><li>inner</li></ul></li></ul><div>Thanks</div>'),
    ).toBe('Steps:\n1. Apply\n2. **Pay**\n- one\n- two\n- inner\nThanks')
  })

  it('reads links, keeping only web addresses', () => {
    expect(fromHtml('<div>See <a href="https://acsti.in/fees">our <b>fees</b></a></div>')).toBe(
      'See [our **fees**](https://acsti.in/fees)',
    )
    expect(fromHtml('<div><a href="https://acsti.in/">https://acsti.in/</a></div>')).toBe('https://acsti.in/')
    expect(fromHtml('<div><a href="javascript:alert(1)">click</a></div>')).toBe('click')
  })

  it('drops scripts and styles, and whatever tags came along, keeping the words', () => {
    expect(fromHtml('<div>Hi<script>alert(1)</script><style>p{}</style> <font color="red">there</font></div>')).toBe('Hi there')
  })

  it('does not pile up blank lines', () => {
    expect(fromHtml('<div><br></div><div>a</div><div><br></div><div><br></div><div><br></div><div>b</div><div><br></div>')).toBe(
      'a\n\nb',
    )
  })

  it('round-trips what it writes', () => {
    const markup = 'Dear Anu,\n\n**Fees** are *due* __today__.\n- one\n- two\n1. Apply\n2. Pay\nSee [fees](https://acsti.in/fees)'
    expect(fromHtml(editorHtmlFromMarkup(markup))).toBe(markup)
  })

  it('writes only fixed tags into the editor, with text escaped', () => {
    const html = editorHtmlFromMarkup('<img src=x onerror=alert(1)> **<b>x</b>**')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toBe('<div>&lt;img src=x onerror=alert(1)&gt; <b>&lt;b&gt;x&lt;/b&gt;</b></div>')
  })

  it('gives the same email as typing the markup would', () => {
    const typed = '**Hello** *there*\n- a\n- b'
    expect(markupToHtml(fromHtml(editorHtmlFromMarkup(typed)))).toBe(markupToHtml(typed))
  })
})
