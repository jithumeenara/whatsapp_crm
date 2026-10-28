import { describe, expect, it } from 'vitest'
import {
  batchDuplicates, confirmParams, groupActive, isSensitiveQuestion, parseConfirm, parseGroup, personNameKey, splitSubmission, whatsappNumber,
  GROUP_HARD_MAX,
} from './form-group'
import { parseFormConfig } from './public-form'

const fields = [
  { key: 'month', label: 'Month', type: 'select' },
  { key: 'programme', label: 'Training Programme', type: 'select' },
  { key: 'society', label: 'Name of Society', type: 'text' },
  { key: 'participant', label: 'Name of Participant', type: 'text' },
  { key: 'whatsapp', label: 'Whatsapp no', type: 'phone' },
  { key: 'aadhaar', label: 'Aadhaar No', type: 'text' },
]
const group = parseGroup({ enabled: true, label: 'Participant', person_keys: ['participant', 'whatsapp', 'aadhaar'], min: 1, max: 5 })

describe('several people in one form — settings', () => {
  it('is off unless switched on, and needs a per-person question to be in use', () => {
    expect(parseFormConfig({}).group.enabled).toBe(false)
    expect(groupActive(parseGroup({ enabled: true, person_keys: [] }))).toBe(false)
    expect(groupActive(group)).toBe(true)
  })

  it('keeps only real fields, caps the count, and never lets min pass max', () => {
    const g = parseGroup({ enabled: true, person_keys: ['participant', 'gone', 7], min: 9, max: 999 }, ['participant'])
    expect(g.person_keys).toEqual(['participant'])
    expect(g.max).toBe(GROUP_HARD_MAX)
    expect(parseGroup({ enabled: true, min: 9, max: 3 }).min).toBe(3)
  })

  it('a confirmation needs a template name Meta could have, and fills only known values', () => {
    expect(parseConfirm({ template: 'Hello there' })).toBeNull()
    expect(parseConfirm({ template: 'reg_ok', phone_key: 'whatsapp', params: ['names', 'field:month', 'field:secret', 'evil'] }, ['whatsapp', 'month']))
      .toEqual({ template: 'reg_ok', phone_key: 'whatsapp', params: ['names', 'field:month', '', ''] })
  })
})

describe('a submission split into once and per person', () => {
  it('takes the shared answers once and each person’s own, dropping answers sent in the wrong place', () => {
    const r = splitSubmission(
      { month: 'December', programme: 'Management', participant: 'sneaked in' },
      [{ participant: 'Jithu L R', whatsapp: '8590551176', month: 'January' }, { participant: 'Anu', whatsapp: '9847000000' }],
      group,
    )
    expect(r).toEqual({
      ok: true,
      shared: { month: 'December', programme: 'Management' },
      people: [{ participant: 'Jithu L R', whatsapp: '8590551176' }, { participant: 'Anu', whatsapp: '9847000000' }],
    })
  })

  it('refuses too few, too many, or a list that is not a list of people', () => {
    expect(splitSubmission({}, [], group).ok).toBe(false)
    expect(splitSubmission({}, Array.from({ length: 6 }, () => ({})), group).ok).toBe(false)
    expect(splitSubmission({}, 'x', group).ok).toBe(false)
    expect(splitSubmission({}, [['a']], group).ok).toBe(false)
  })
})

describe('the same person twice in one form', () => {
  it('catches a repeated phone number however it was typed, and names the person', () => {
    const problems = batchDuplicates(
      [{ participant: 'Jithu', whatsapp: '+91 85905 51176' }, { participant: 'Anu', whatsapp: '9847000000' }, { participant: 'J', whatsapp: '8590551176' }],
      fields, group,
    )
    expect(problems).toEqual(['Participant 3: the same Whatsapp no as participant 1.'])
  })

  it('catches two identical people, and lets different ones through', () => {
    expect(batchDuplicates([{ participant: 'Anu' }, { participant: 'anu ' }], fields, group)).toEqual(['Participant 2 is the same as participant 1.'])
    expect(batchDuplicates([{ participant: 'Anu' }, { participant: 'Biju' }], fields, group)).toEqual([])
  })
})

describe('confirmations', () => {
  it('fills the template from the answers and the list of names; an empty value becomes a dash', () => {
    const spec = { template: 't', phone_key: 'whatsapp', params: ['names', 'count', 'field:programme', 'reference', 'person_name', 'field:aadhaar'] }
    expect(confirmParams(spec, { data: { programme: 'Management' }, names: ['Jithu', 'Anu'], count: 2, reference: 'AB12CD34', business: 'ACSTI', personName: 'Anu' }))
      .toEqual(['Jithu, Anu', '2', 'Management', 'AB12CD34', 'Anu', '-'])
  })

  it('counts people even when nobody has a name question', () => {
    const spec = { template: 't', phone_key: '', params: ['count'] }
    expect(confirmParams(spec, { data: {}, names: [], count: 3, reference: 'R', business: 'B' })).toEqual(['3'])
  })

  // A public form: whoever fills it chooses the numbers and the names.
  it('never sends a link or an ID number a stranger typed', () => {
    const spec = { template: 't', phone_key: '', params: ['names', 'field:society', 'field:aadhaar'] }
    const sent = confirmParams(spec, {
      data: { society: 'Win now at bit.ly/x9 or https://evil.example', aadhaar: '1234 5678 9012' },
      names: ['Claim prize www.evil.in now'], count: 1, reference: 'R', business: 'B',
      sensitive: new Set(['aadhaar']),
    })
    expect(sent.join(' ')).not.toMatch(/bit\.ly|https?:|www\.|evil|1234/)
    expect(sent[0]).toBe('Claim prize now')
    expect(sent[2]).toBe('-')
  })

  it('knows which questions are sensitive', () => {
    expect(isSensitiveQuestion({ key: 'aadhaar', label: 'Aadhaar No' })).toBe(true)
    expect(isSensitiveQuestion({ key: 'acc', label: 'Bank account number' })).toBe(true)
    expect(isSensitiveQuestion({ key: 'programme', label: 'Training Programme' })).toBe(false)
  })

  it('turns a typed number into a WhatsApp number with the business’s country code', () => {
    expect(whatsappNumber('85905 51176', '+91')).toBe('918590551176')
    expect(whatsappNumber('08590551176', '+91')).toBe('918590551176')
    expect(whatsappNumber('+971 50 123 4567', '+91')).toBe('971501234567')
    expect(whatsappNumber('918590551176', '+91')).toBe('918590551176')
    expect(whatsappNumber('123', '+91')).toBeNull()
    expect(whatsappNumber('', '+91')).toBeNull()
  })

  it('names a person by their name question, not the society’s', () => {
    expect(personNameKey(fields, ['society', 'participant', 'whatsapp'])).toBe('participant')
    expect(personNameKey(fields, ['whatsapp'])).toBeNull()
  })
})
