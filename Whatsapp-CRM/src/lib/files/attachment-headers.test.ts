import { describe, expect, it } from 'vitest'
import { attachmentHeaders } from './account-files'

// A customer chooses the type their attachment claims. A Telegram or
// WhatsApp document labelled text/html or image/svg+xml must never render
// on the CRM's origin, where its script would run as the staff member.
describe('attachmentHeaders', () => {
  it('an HTML document from a customer is a download, not a page', () => {
    const h = attachmentHeaders('text/html', 'invoice.html')
    expect(h['Content-Type']).toBe('application/octet-stream')
    expect(h['Content-Disposition']).toMatch(/^attachment;/)
    expect(h['Content-Security-Policy']).toBe('sandbox')
  })

  it('an SVG is a download too — it can carry script', () => {
    const h = attachmentHeaders('image/svg+xml', 'logo.svg')
    expect(h['Content-Type']).toBe('application/octet-stream')
    expect(h['Content-Disposition']).toMatch(/^attachment;/)
  })

  it('photos, voice notes and PDFs still open inline', () => {
    expect(attachmentHeaders('image/jpeg', 'a.jpg')['Content-Disposition']).toMatch(/^inline;/)
    expect(attachmentHeaders('audio/ogg; codecs=opus', 'v.ogg')['Content-Type']).toBe('audio/ogg')
    expect(attachmentHeaders('application/pdf', 'r.pdf')['Content-Disposition']).toMatch(/^inline;/)
  })

  it('a Word file keeps its type but downloads', () => {
    const h = attachmentHeaders('application/msword', 'cv.doc')
    expect(h['Content-Type']).toBe('application/msword')
    expect(h['Content-Disposition']).toMatch(/^attachment;/)
  })

  it('a missing type and a hostile filename are safe', () => {
    const h = attachmentHeaders(null, 'a"\r\nSet-Cookie: x')
    expect(h['Content-Type']).toBe('application/octet-stream')
    expect(h['Content-Disposition']).not.toMatch(/[\r\n]/)
  })
})
