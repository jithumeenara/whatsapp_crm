import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { ADDED_ON_HEADER, addedOnText, cellText, exportHeader, exportRow, mapHeaders, rowKey, rowsToRecords } from './sheet-sync'
import { isGoogleClientId, projectNumberOf, googleAuthorizeUrl } from './oauth'
import { tabRange } from './sheets'

const fields = [
  { field_key: 'name_of_participant', label: 'Name of Participant', field_type: 'text' },
  { field_key: 'whatsapp_no', label: 'Whatsapp no', field_type: 'phone' },
  { field_key: 'month', label: 'month', field_type: 'select' },
  { field_key: 'intro', label: 'Intro', field_type: 'section_header' },
  { field_key: 'photo', label: 'Photo', field_type: 'image' },
]

describe('export rows', () => {
  it('has a column per field (layout fields left out) and an "Added on" column', () => {
    expect(exportHeader(fields)).toEqual(['Name of Participant', 'Whatsapp no', 'month', 'Photo', ADDED_ON_HEADER])
  })

  it('writes values as text, in the business time zone', () => {
    const at = new Date('2026-10-09T20:00:00Z') // 1:30 a.m. on the 10th in Kolkata
    const row = exportRow(fields, { name_of_participant: 'Shiju K', whatsapp_no: '9947840578', month: ['october', 'november'] }, at, 'Asia/Kolkata')
    expect(row.slice(0, 4)).toEqual(['Shiju K', '9947840578', 'october, november', ''])
    expect(row[4]).toContain('10 Oct 2026')
    expect(addedOnText(at, 'UTC')).toContain('9 Oct 2026')
  })

  it('turns stored values into plain cell text', () => {
    expect(cellText(true)).toBe('Yes')
    expect(cellText(null)).toBe('')
    expect(cellText({ a: 1 })).toBe('{"a":1}')
  })
})

describe('import', () => {
  it('matches headers to fields by label or key, ignoring case and spaces', () => {
    expect(mapHeaders(['name of  participant', 'WHATSAPP_NO', 'Added on', 'Photo', 'Unknown'], fields)).toEqual([
      'name_of_participant',
      'whatsapp_no',
      null,
      null, // an image cannot come from a sheet
      null,
    ])
  })

  it('fingerprints a row the same way every time, whatever the key order', () => {
    expect(rowKey({ a: '1', b: '2' })).toBe(rowKey({ b: '2', a: '1' }))
    expect(rowKey({ a: '1' })).not.toBe(rowKey({ a: '2' }))
  })

  it('skips empty rows and blank cells', () => {
    const out = rowsToRecords(
      [['Shiju K', ' 9947840578 '], ['', ''], ['Sujith M', '']],
      ['name_of_participant', 'whatsapp_no'],
    )
    expect(out.map((r) => r.data)).toEqual([
      { name_of_participant: 'Shiju K', whatsapp_no: '9947840578' },
      { name_of_participant: 'Sujith M' },
    ])
  })
})

describe('Google OAuth helpers', () => {
  const id = '123456789012-abcdef123.apps.googleusercontent.com'

  it('knows a client id and reads the project number from it', () => {
    expect(isGoogleClientId(id)).toBe(true)
    expect(isGoogleClientId('not-a-client')).toBe(false)
    expect(projectNumberOf(id)).toBe('123456789012')
  })

  it('asks only for drive.file, offline, with PKCE', () => {
    const url = new URL(googleAuthorizeUrl({ clientId: id, redirectUri: 'https://crm.example.com/api/google/callback', state: 's', challenge: 'c' }))
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/drive.file')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('quotes a tab name for a range', () => {
    expect(tabRange("Ministerial's list")).toBe("'Ministerial''s list'")
  })
})
