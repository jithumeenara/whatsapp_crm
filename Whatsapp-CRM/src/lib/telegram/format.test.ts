import { describe, expect, it } from 'vitest'
import { toTelegramHtml } from './format'

/**
 * 20 Oct, live: messages sent to Telegram showed *stars* and _underscores_
 * instead of bold and italic. Everything in the CRM is written in WhatsApp's
 * markup; Telegram needs its own (HTML here).
 */
describe('WhatsApp formatting on Telegram', () => {
  it('bold, italic, strike', () => {
    expect(toTelegramHtml('*Fees* are _due_ ~today~')).toBe('<b>Fees</b> are <i>due</i> <s>today</s>')
  })

  it('code blocks and inline code keep their text as it is', () => {
    expect(toTelegramHtml('Use ```*not bold*``` and `a_b_c`')).toBe('Use <pre>*not bold*</pre> and <code>a_b_c</code>')
  })

  it('escapes what Telegram would read as markup', () => {
    expect(toTelegramHtml('1 < 2 & 3 > 2 <b>x</b>')).toBe('1 &lt; 2 &amp; 3 &gt; 2 &lt;b&gt;x&lt;/b&gt;')
  })

  it('leaves stray symbols alone', () => {
    expect(toTelegramHtml('2 * 3 = 6, file_name_v2.pdf, a*b')).toBe('2 * 3 = 6, file_name_v2.pdf, a*b')
    expect(toTelegramHtml('*not closed')).toBe('*not closed')
  })

  it('formatting at line starts and in Malayalam', () => {
    expect(toTelegramHtml('*ഫീസ്*\n_അവസാന തീയതി_: 30')).toBe('<b>ഫീസ്</b>\n<i>അവസാന തീയതി</i>: 30')
  })

  it('a quote line', () => {
    expect(toTelegramHtml('> Note this\nNext')).toBe('<blockquote>Note this</blockquote>\nNext')
  })
})
