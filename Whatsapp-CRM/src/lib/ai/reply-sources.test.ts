import { describe, it, expect } from 'vitest'
import { attributeLines, distinctiveTokens, replyLines } from './reply-sources'

// The reply from the screenshot: Malayalam around English programme names.
const REPLY = `ഞങ്ങളിൽ പ്രധാനമായും ലഭ്യമായ പരിശീലന പ്രോഗ്രാമുകൾ താഴെ പറയുന്നവയാണ്:

- *Statutory Training Programme (STP)* (സബ് സ്റ്റാഫ്, മിനിസ്റ്റീരിയൽ സ്റ്റാഫ്, സൂപ്പർവൈസറി സ്റ്റാഫ്)
- *Leadership and Good Governance (Rule 50 A)* (ബോർഡ് അംഗങ്ങൾക്ക്)
- *Business Development Plan (Recovery / NPA Management / KYC)*
- *Gold Loan Appraisal & Fraud Prevention*

ഇതിൽ ഏത് വിഭാഗത്തിലെ പ്രോഗ്രാമിനെക്കുറിച്ചാണ് കൂടുതൽ അറിയേണ്ടത്?`

describe('reply lines and words', () => {
  it('cuts a reply into readable lines without list marks', () => {
    const lines = replyLines(REPLY)
    expect(lines[1]).toBe('Statutory Training Programme (STP) (സബ് സ്റ്റാഫ്, മിനിസ്റ്റീരിയൽ സ്റ്റാഫ്, സൂപ്പർവൈസറി സ്റ്റാഫ്)')
    expect(lines).toHaveLength(6)
  })

  it('keeps the distinctive words only', () => {
    expect(distinctiveTokens('The fee is ₹2360 for the Gold Loan course')).toEqual(['fee', '2360', 'gold', 'loan', 'course'])
  })
})

describe('which source a line came from', () => {
  const brochure = 'Programmes: Statutory Training Programme (STP) for sub staff. Business Development Plan (Recovery / NPA Management / KYC). Gold Loan Appraisal and Fraud Prevention.'
  const instructions = 'You are the assistant of ACSTI. Leadership and Good Governance (Rule 50 A) is for board members.'

  it('credits each line to the source that contains it, and flags what none contains', () => {
    const lines = attributeLines(REPLY, [brochure, instructions])
    const sourceOf = (start: string) => lines.find((l) => l.line.startsWith(start))?.source
    expect(sourceOf('Statutory')).toBe(0)
    expect(sourceOf('Business Development')).toBe(0)
    expect(sourceOf('Gold Loan')).toBe(0)
    expect(sourceOf('Leadership')).toBe(1)
    // The Malayalam-only lines are not judged.
    expect(lines).toHaveLength(4)
  })

  it('marks a line found nowhere as unsupported', () => {
    const lines = attributeLines('- Diploma in Cooperative Banking starts on 12 November, fee 9000', [brochure])
    expect(lines).toEqual([expect.objectContaining({ source: null })])
  })

  it('prefers the earlier source on a tie', () => {
    const lines = attributeLines('Gold Loan Appraisal course', ['gold loan appraisal course', 'gold loan appraisal course'])
    expect(lines[0].source).toBe(0)
  })
})
