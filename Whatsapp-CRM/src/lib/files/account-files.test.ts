import { describe, it, expect } from 'vitest'
import { contentMatchesType, extensionFor, isAllowedMime, servableMime } from './account-files'

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

describe('uploads are what they say, and named by it', () => {
  it('checks voice notes and audio by their first bytes', () => {
    expect(contentMatchesType('audio/ogg', Buffer.from('OggS\0\0\0\0'))).toBe(true)
    expect(contentMatchesType('audio/amr', Buffer.from('#!AMR\n'))).toBe(true)
    expect(contentMatchesType('audio/mpeg', Buffer.from('ID3\x03\0'))).toBe(true)
    expect(contentMatchesType('audio/ogg', Buffer.from('<html><script>'))).toBe(false)
    expect(contentMatchesType('image/png', Buffer.from('<html><script>'))).toBe(false)
  })

  it('names a stored file by its checked type, not the uploader’s extension', () => {
    expect(extensionFor('image/png')).toBe('.png')
    expect(extensionFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('.xlsx')
    expect(extensionFor('text/html')).toBe('.bin')
  })

  it('serves only known types as themselves', () => {
    expect(servableMime('image/jpeg')).toBe(true)
    expect(servableMime('audio/webm')).toBe(true)
    expect(servableMime('text/html')).toBe(false)
    expect(servableMime('image/svg+xml')).toBe(false)
  })
})
