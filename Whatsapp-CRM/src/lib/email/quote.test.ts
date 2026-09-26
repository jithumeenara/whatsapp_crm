import { describe, it, expect } from 'vitest'
import { splitQuoted } from './quote'
import { baseSubject, cleanSubject, replySubject } from './conversation-send'

describe('splitQuoted', () => {
  it('folds a Gmail quote', () => {
    const r = splitQuoted('Thanks, see you Monday.\n\nOn Fri, 26 Sep 2026 at 17:03, ACSTI <training@acstikerala.com> wrote:\n> ok\n')
    expect(r.main).toBe('Thanks, see you Monday.')
    expect(r.quoted).toContain('wrote:')
  })

  it('folds an Outlook quote', () => {
    const r = splitQuoted('Please send the fees.\r\n\r\n________________________________\r\nFrom: ACSTI Training <training@acstikerala.com>\r\nSent: Friday, 26 September 2026 5:04 PM\r\nSubject: RE: test\r\n\r\nok')
    expect(r.main).toBe('Please send the fees.')
    expect(r.quoted).toMatch(/^_{8,}/)
  })

  it('folds a trailing block of > lines', () => {
    const r = splitQuoted('Yes\n\n> earlier line\n> another')
    expect(r).toEqual({ main: 'Yes', quoted: '> earlier line\n> another' })
  })

  it('leaves an email with no history alone', () => {
    expect(splitQuoted('Hello,\nI need training details.')).toEqual({ main: 'Hello,\nI need training details.', quoted: null })
  })

  it('never folds everything away', () => {
    expect(splitQuoted('> only quoted').quoted).toBeNull()
  })
})

describe('subjects', () => {
  it('strips header-breaking characters and caps length', () => {
    expect(cleanSubject('Hi\r\nBcc: evil@x.com')).toBe('Hi Bcc: evil@x.com')
    expect(cleanSubject('x'.repeat(400))).toHaveLength(250)
    expect(cleanSubject(42)).toBe('')
  })

  it('makes one Re: however many there were', () => {
    expect(baseSubject('Re: RE: Fwd: Admission')).toBe('Admission')
    expect(replySubject('RE: test')).toBe('Re: test')
    expect(replySubject(null)).toBeNull()
  })
})
