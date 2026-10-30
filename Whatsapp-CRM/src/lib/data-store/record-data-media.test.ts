import { describe, expect, it } from 'vitest'
import { checkRecordData } from './record-data'

/**
 * A7-04 handoff: a file, image or signature value is shown to staff as a
 * link and an <img>. The browser side now refuses odd schemes, but the
 * records API stored anything — `javascript:…`, `data:text/html,…`,
 * `//evil.example` — for the next screen, export or integration to trust.
 */

const fields = [
  { field_key: 'photo', field_type: 'image' },
  { field_key: 'sig', field_type: 'signature' },
  { field_key: 'cv', field_type: 'file' },
  { field_key: 'note', field_type: 'text' },
]

describe('checkRecordData — file, image and signature values', () => {
  for (const [key, value] of [
    ['photo', 'javascript:alert(1)'],
    ['cv', 'data:text/html,<script>alert(1)</script>'],
    ['sig', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['cv', '//evil.example/x.pdf'],
    ['photo', 'vbscript:msgbox'],
    ['cv', 'data:image/png;base64,AAAA'], // inline data is for images only
  ] as const) {
    it(`refuses ${key} = ${value.slice(0, 30)}`, () => {
      const r = checkRecordData({ [key]: value }, fields)
      expect(r.ok).toBe(false)
    })
  }

  it('keeps web links, app uploads, raster signatures, empty values and other fields as they are', () => {
    const data = {
      photo: 'https://cdn.example.com/a.jpg',
      cv: '/api/files/account-1/x.pdf',
      sig: 'data:image/png;base64,iVBORw0KGgo=',
      note: 'javascript: is just text in a text field',
    }
    expect(checkRecordData(data, fields)).toEqual({ ok: true, data })
    expect(checkRecordData({ photo: '' }, fields).ok).toBe(true)
    expect(checkRecordData({ photo: null }, fields).ok).toBe(true)
  })
})
