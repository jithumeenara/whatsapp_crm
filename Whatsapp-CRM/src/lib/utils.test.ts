import { describe, expect, it } from 'vitest'
import { safeHref } from './utils'

describe('safeHref', () => {
  it('keeps web, app and blob addresses', () => {
    expect(safeHref('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('/api/whatsapp/media/123')).toBe('/api/whatsapp/media/123')
    expect(safeHref('blob:https://crm.example.com/0b1c')).toBe('blob:https://crm.example.com/0b1c')
  })

  it('refuses script-bearing and off-site-relative addresses', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml;base64,PHN2Zz4=',
      '//evil.example/x',
      '/\\evil.example/x',
      'file:///etc/passwd',
      '',
      null,
      42,
    ]) {
      expect(safeHref(bad, { dataImage: true })).toBeUndefined()
    }
  })

  it('lets a raster inline image through only when asked', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(safeHref(png)).toBeUndefined()
    expect(safeHref(png, { dataImage: true })).toBe(png)
  })
})
