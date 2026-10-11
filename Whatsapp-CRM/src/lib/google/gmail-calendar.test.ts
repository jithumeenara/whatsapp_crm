import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { addressesIn, buildMime, encodeHeader, readParts } from './gmail'
import { DEFAULT_CALENDAR_SETTINGS, candidateSlots, parseCalendarSettings } from './calendar'

describe('Gmail messages', () => {
  it('leaves a plain subject alone and encodes anything else', () => {
    expect(encodeHeader('Your order')).toBe('Your order')
    expect(encodeHeader('നമസ്കാരം')).toMatch(/^=\?UTF-8\?B\?.+\?=$/)
  })

  it('cannot be made to add a header through the subject or an address', () => {
    const raw = buildMime({ from: 'a@b.com', to: ['c@d.com\r\nBcc: x@y.com'], subject: 'Hi\r\nBcc: z@y.com', text: 't', html: '<p>t</p>' }, 'seed')
    expect(raw.split('\r\n').filter((l) => l.startsWith('Bcc:'))).toEqual([])
  })

  it('threads a reply and carries attachments in a mixed body', () => {
    const raw = buildMime(
      { from: 'a@b.com', to: ['c@d.com'], subject: 'Re: x', text: 't', html: 'h', inReplyTo: 'abc@mail.gmail.com', attachments: [{ name: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('pdf') }] },
      'seed',
    )
    expect(raw).toContain('In-Reply-To: <abc@mail.gmail.com>')
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="mixed_seed"')
    expect(raw).toContain('filename="a.pdf"')
    expect(raw.trimEnd().endsWith('--mixed_seed--')).toBe(true)
  })

  it('reads the body and the files out of Gmail’s parsed tree', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url')
    const out = readParts({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('hello') } }, { mimeType: 'text/html', body: { data: b64('<b>hello</b>') } }] },
        { mimeType: 'application/pdf', filename: 'f.pdf', body: { attachmentId: 'att1', size: 9 } },
      ],
    })
    expect(out.text).toBe('hello')
    expect(out.html).toBe('<b>hello</b>')
    expect(out.files).toEqual([{ name: 'f.pdf', mime: 'application/pdf', attachmentId: 'att1', size: 9 }])
  })

  it('pulls addresses out of a header, lowercased and once each', () => {
    expect(addressesIn('Anu <Anu@X.com>, b@y.in, anu@x.com')).toEqual(['anu@x.com', 'b@y.in'])
  })
})

describe('calendar slots', () => {
  it('distrusts stored settings', () => {
    const s = parseCalendarSettings({ slotMinutes: 7, dayStart: '18:00', dayEnd: '09:00', workDays: [9, 1, 1], daysAhead: 500, calendarId: 'x y' })
    expect(s.slotMinutes).toBe(DEFAULT_CALENDAR_SETTINGS.slotMinutes)
    expect(s.dayEnd).toBe(DEFAULT_CALENDAR_SETTINGS.dayEnd)
    expect(s.workDays).toEqual([1])
    expect(s.daysAhead).toBe(60)
    expect(s.calendarId).toBe('primary')
  })

  it('builds slots in the business zone, on working days, after the lead time', () => {
    const settings = { ...DEFAULT_CALENDAR_SETTINGS, slotMinutes: 60, dayStart: '09:00', dayEnd: '12:00', workDays: [1], leadHours: 0 }
    // Sunday 11 Oct 2026, 20:00 in Kolkata (14:30 UTC).
    const now = new Date('2026-10-11T14:30:00Z')
    const slots = candidateSlots(settings, 'Asia/Kolkata', now, 2)
    // Only Monday: 09:00, 10:00, 11:00 IST = 03:30, 04:30, 05:30 UTC.
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-10-12T03:30:00.000Z',
      '2026-10-12T04:30:00.000Z',
      '2026-10-12T05:30:00.000Z',
    ])
  })

  it('drops today’s slots that are already past or inside the lead time', () => {
    const settings = { ...DEFAULT_CALENDAR_SETTINGS, slotMinutes: 60, dayStart: '09:00', dayEnd: '12:00', workDays: [1], leadHours: 2 }
    // Monday 12 Oct, 08:30 IST: 09:00 and 10:00 are inside two hours.
    const slots = candidateSlots(settings, 'Asia/Kolkata', new Date('2026-10-12T03:00:00Z'), 1)
    expect(slots.map((d) => d.toISOString())).toEqual(['2026-10-12T05:30:00.000Z'])
  })
})
