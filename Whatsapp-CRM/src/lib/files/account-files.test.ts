import { describe, it, expect } from 'vitest'
import { contentMatchesType, isAllowedMime } from './account-files'

describe('contentMatchesType', () => {
  it('accepts real files', () => {
    expect(contentMatchesType('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true)
    expect(contentMatchesType('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true)
    expect(contentMatchesType('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(contentMatchesType('text/csv', Buffer.from('name,phone\nAnu,98'))).toBe(true)
  })

  it('refuses a file that is not what it claims', () => {
    // A Windows program labelled as a PDF.
    expect(contentMatchesType('application/pdf', Buffer.from('MZ\x90\x00'))).toBe(false)
    expect(contentMatchesType('text/plain', Buffer.from([0x4d, 0x5a, 0x00, 0x00]))).toBe(false)
  })

  it('never accepts a type outside the list', () => {
    expect(isAllowedMime('image/svg+xml')).toBe(false)
    expect(isAllowedMime('application/x-msdownload')).toBe(false)
    expect(contentMatchesType('application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
  })
})
