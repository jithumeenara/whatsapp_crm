import { describe, it, expect } from 'vitest'
import { checkPhrases } from './runner'
import { isTestableQuestion, questionKey } from './real-questions'
import { customerToolDeclarations, runCustomerTool } from '../customer-tools'

describe('exact checks on a test', () => {
  const reply = [
    'ഒക്ടോബറിലെ പ്രോഗ്രാമുകൾ:',
    '- *Statutory Training Programme (STP) (M)* — 12 Oct 2026 – 16 Oct 2026 · Fee: 5,900',
    '- *Gold loan Appraisal and Prevention of Fraud* — Fee: 2,360',
  ].join('\n')

  it('passes when every phrase is there and none of the forbidden ones', () => {
    expect(checkPhrases(reply, ['gold loan appraisal', 'Statutory Training Programme (STP) (M)', 'fee: 2360'], ['Leadership'])).toBeNull()
  })

  it('names what is missing and what should not be there', () => {
    expect(checkPhrases(reply, ['(STP) (SV)'], ['Gold loan'])).toBe('Missing: "(STP) (SV)". Should not say: "Gold loan".')
  })

  it('does nothing when there are no phrases', () => {
    expect(checkPhrases(reply, null, null)).toBeNull()
  })
})

describe('questions offered from real chats', () => {
  it('offers real questions, in any language', () => {
    expect(isTestableQuestion('ഒക്ടോബർ മാസം ഏതൊക്കെ ട്രെയിനിങ് ആണ് ഉള്ളത്')).toBe(true)
    expect(isTestableQuestion('What is the fee for the diploma?')).toBe(true)
  })

  it('never offers personal details, greetings or submitted forms', () => {
    expect(isTestableQuestion('my number is 98000 12345, call me')).toBe(false)
    expect(isTestableQuestion('mail me at someone@example.com')).toBe(false)
    expect(isTestableQuestion('aadhaar 1234 5678 9012')).toBe(false)
    expect(isTestableQuestion('Hello')).toBe(false)
    expect(isTestableQuestion('ശരി')).toBe(false)
    expect(isTestableQuestion('Name: A Person\nSociety: Some Bank\nDistrict: Thrissur')).toBe(false)
  })

  it('treats the same question typed differently as one', () => {
    expect(questionKey('Fee  details?')).toBe(questionKey('fee details'))
  })
})

describe('tools a context was not given', () => {
  const readOnly = { accountId: 'acc', contactId: '', readOnly: true }

  it('offers a read-only context only lookups of business data', () => {
    const names = customerToolDeclarations({ ...readOnly, canSearchTables: true }).map((d) => d.name).sort()
    expect(names).toEqual(['product_catalog', 'registration_forms', 'search_records'])
  })

  it('refuses to run a tool that was not offered, whatever its name', async () => {
    const out = (await runCustomerTool('submit_registration', {}, readOnly)) as { error?: string }
    expect(out.error).toMatch(/No such tool: submit_registration/)
    const noTables = (await runCustomerTool('search_records', { table: 'x' }, { accountId: 'acc', contactId: 'c' })) as { error?: string }
    expect(noTables.error).toMatch(/No such tool: search_records/)
  })
})
