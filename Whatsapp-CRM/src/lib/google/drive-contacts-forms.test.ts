import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { driveTarget } from './drive'
import { toDialable } from './contacts'
import { EMAIL_QUESTION, SUBMITTED_QUESTION, planFields, responseToData, type GoogleForm } from './forms'

describe('Drive attachments', () => {
  it('sends Google Docs as PDF and Sheets as Excel', () => {
    expect(driveTarget({ name: 'Brochure', mimeType: 'application/vnd.google-apps.document' })).toEqual({ mime: 'application/pdf', name: 'Brochure.pdf', exported: true })
    expect(driveTarget({ name: 'Fees', mimeType: 'application/vnd.google-apps.spreadsheet' })).toMatchObject({ name: 'Fees.xlsx', exported: true })
  })

  it('refuses what cannot be sent, with the reason', () => {
    expect(driveTarget({ name: 'a.zip', mimeType: 'application/zip' })).toHaveProperty('error')
    expect(driveTarget({ name: 'Map', mimeType: 'application/vnd.google-apps.map' })).toHaveProperty('error')
    expect(driveTarget({ name: 'big.pdf', mimeType: 'application/pdf', size: String(20 * 1024 * 1024) })).toHaveProperty('error')
    expect(driveTarget({ name: 'ok.pdf', mimeType: 'application/pdf', size: '1000' })).toEqual({ mime: 'application/pdf', name: 'ok.pdf', exported: false })
  })
})

describe('Google Contacts numbers', () => {
  it('trusts Google’s own international form first', () => {
    expect(toDialable({ value: '098470 12345', canonicalForm: '+919847012345' }, null)).toBe('919847012345')
  })

  it('adds the account’s usual country code to a local number, and only then', () => {
    expect(toDialable({ value: '098470 12345' }, '91')).toBe('919847012345')
    expect(toDialable({ value: '98470 12345' }, null)).toBeNull()
    expect(toDialable({ value: '+44 20 7946 0958' }, '91')).toBe('442079460958')
    expect(toDialable({ value: '0044 20 7946 0958' }, '91')).toBe('442079460958')
    expect(toDialable({ value: '123' }, '91')).toBeNull()
  })
})

describe('Google Forms', () => {
  const form: GoogleForm = {
    formId: 'f',
    settings: { emailCollectionType: 'VERIFIED' },
    items: [
      { title: 'Name', questionItem: { question: { questionId: 'q1', textQuestion: {} } } },
      { title: 'Course', questionItem: { question: { questionId: 'q2', choiceQuestion: { type: 'RADIO', options: [{ value: 'A' }, { value: 'B' }, { isOther: true }] } } } },
      { title: 'Interests', questionItem: { question: { questionId: 'q3', choiceQuestion: { type: 'CHECKBOX', options: [{ value: 'X' }] } } } },
      { title: 'About you', questionItem: { question: { questionId: 'q4', textQuestion: { paragraph: true } } } },
      {
        title: 'Rate',
        questionGroupItem: { questions: [{ questionId: 'g1', rowQuestion: { title: 'Food' } }], grid: { columns: { type: 'RADIO', options: [{ value: 'Good' }] } } },
      },
      { title: 'Section text only' },
    ],
  }

  it('makes one typed field per question, a grid row each, plus email and time', () => {
    const f = planFields(form)
    expect(f.map((x) => [x.label, x.field_type])).toEqual([
      ['Email', 'email'],
      ['Name', 'text'],
      ['Course', 'select'],
      ['Interests', 'multiselect'],
      ['About you', 'textarea'],
      ['Rate — Food', 'select'],
      ['Submitted at', 'datetime'],
    ])
    expect(f[2].options).toEqual([{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }])
  })

  it('turns a response into a record, several choices kept as a list', () => {
    const map = { q1: 'name', q3: 'interests', [EMAIL_QUESTION]: 'email', [SUBMITTED_QUESTION]: 'submitted_at' }
    const data = responseToData(
      {
        responseId: 'r1',
        lastSubmittedTime: '2026-10-11T05:00:00Z',
        respondentEmail: ' Anu@X.com ',
        answers: {
          q1: { textAnswers: { answers: [{ value: 'Anu' }] } },
          q3: { textAnswers: { answers: [{ value: 'X' }, { value: 'Y' }] } },
          unknown: { textAnswers: { answers: [{ value: 'dropped' }] } },
        },
      },
      map,
      new Set(['interests']),
    )
    expect(data).toEqual({ name: 'Anu', interests: ['X', 'Y'], email: 'anu@x.com', submitted_at: '2026-10-11T05:00:00Z' })
  })
})
