import { describe, it, expect } from 'vitest'
import { ungroundedListItems, removeLines, enforceGroundedList, groundingCorrection } from './list-grounding'

// What the assistant was given at 12:43 on 28 Sep (production): the whole
// Training table and the fee Q&A.
const TRAINING = [
  'TABLE: Training\nFIELDS: Name of programme, Target group, Month, Date from, Date To, Fee',
  'Name of programme: Statutory Training Programme (STP) (S)\nTarget group: Sub-staff\nMonth: september\nDate from: 2026-09-29\nDate To: 2026-10-01\nFee: 3540',
  'Name of programme: Statutory Training Programme (STP) (M)\nTarget group: Ministerial Cadre\nMonth: october\nDate from: 2026-10-12\nDate To: 2026-10-16\nFee: 5900',
  'Name of programme: Gold loan Appraisal and Prevention of Fraud\nTarget group: All categories of Staff\nMonth: october\nDate from: 2026-10-16\nDate To: 2026-10-17\nFee: 2360',
  'Name of programme: Statutory Training Programme (STP) (SV)\nTarget group: Supervisory Cadre\nMonth: october\nDate from: 2026-10-26\nDate To: 2026-10-31\nFee: 7080',
].join('\n\n')
const QA = 'Q: How can I pay the training fee?\nA: Pay online through the link sent after registration.'
const SOURCES = [TRAINING, QA, 'ഏതൊക്കെ ട്രെയിനിങ് പ്രോഗ്രാമുകൾ ആണുള്ളത് അവിടെ']

// The reply that was sent, word for word.
const REPLY = `ഞങ്ങളുടെ സ്ഥാപനത്തിൽ പ്രധാനമായും താഴെ പറയുന്ന പരിശീലന പ്രോഗ്രാമുകളാണ് ഉള്ളത്:

- *Statutory Training Programme (STP)* (സബ് സ്റ്റാഫ്, മിനിസ്റ്റീരിയൽ, സൂപ്പർവൈസറി ജീവനക്കാർക്ക്)
- *Leadership and Good Governance (Rule 50 A)* (ഡയറക്ടർ ബോർഡ് അംഗങ്ങൾക്ക്)
- *Business Development Plan (Recovery / NPA Management / KYC)*
- *Self-Sustenance through Management of Resources* (PACS വനിതാ ഓഫീസർമാർക്ക്)
- *Gold Loan Appraisal & Fraud Prevention* (എല്ലാ വിഭാഗം ജീവനക്കാർക്കും)

ഏത് മാസത്തെ ട്രെയിനിങ് പ്രോഗ്രാമുകളുടെ വിവരങ്ങളാണ് താങ്കൾക്ക് അറിയേണ്ടത്?`

const INVENTED = [
  '- *Leadership and Good Governance (Rule 50 A)* (ഡയറക്ടർ ബോർഡ് അംഗങ്ങൾക്ക്)',
  '- *Business Development Plan (Recovery / NPA Management / KYC)*',
  '- *Self-Sustenance through Management of Resources* (PACS വനിതാ ഓഫീസർമാർക്ക്)',
]

describe('which list items no source has', () => {
  it('flags exactly the three programmes that were copied from earlier replies', () => {
    expect(ungroundedListItems(REPLY, SOURCES)).toEqual(INVENTED)
  })

  it('passes items reworded from the source, and a fee written with a comma', () => {
    const ok = [
      'October-ൽ ഉള്ളവ:',
      '1. *Gold Loan Appraisal & Fraud Prevention* — 16–17 Oct 2026, ഫീസ് ₹2,360',
      '2) Statutory Training Programme (STP) (M) — Ministerial Cadre, fee 5,900',
    ].join('\n')
    expect(ungroundedListItems(ok, SOURCES)).toEqual([])
  })

  it('does not judge bold lines, Malayalam-only items, or the customer’s own words', () => {
    const text = [
      '*Leadership and Good Governance* is not a list item',
      '- ബോർഡ് അംഗങ്ങൾക്കുള്ള പരിശീലനം',
      '- Kerala Bank Thrissur branch',
    ].join('\n')
    expect(ungroundedListItems(text, [...SOURCES, 'I work at Kerala Bank, Thrissur branch'])).toEqual([])
  })
})

describe('keeping them out of the reply', () => {
  it('uses the rewrite when it is clean', async () => {
    const clean = REPLY.split('\n').filter((l) => !INVENTED.includes(l)).join('\n')
    let correction = ''
    const out = await enforceGroundedList({
      reply: REPLY,
      sources: SOURCES,
      regenerate: async (c) => {
        correction = c
        return clean
      },
    })
    expect(out).toEqual({ reply: clean, caught: INVENTED, rewritten: true })
    expect(correction).toContain('Leadership and Good Governance')
    expect(correction).toContain('earlier replies')
  })

  it('removes what the rewrite still invents', async () => {
    const stillBad = `ഉള്ളവ:\n- Gold loan Appraisal and Prevention of Fraud\n${INVENTED[0]}`
    const out = await enforceGroundedList({ reply: REPLY, sources: SOURCES, regenerate: async () => stillBad })
    expect(out.reply).toBe('ഉള്ളവ:\n- Gold loan Appraisal and Prevention of Fraud')
  })

  it('falls back to the draft minus its invented lines when the rewrite fails', async () => {
    const out = await enforceGroundedList({
      reply: REPLY,
      sources: SOURCES,
      regenerate: async () => {
        throw new Error('provider down')
      },
    })
    expect(out.rewritten).toBe(false)
    expect(out.reply).toBe(removeLines(REPLY, INVENTED))
    expect(out.reply).toContain('Gold Loan Appraisal')
    expect(out.reply).not.toContain('Rule 50 A')
  })

  it('leaves a grounded reply alone without calling the model', async () => {
    let called = false
    const reply = '- Gold loan Appraisal and Prevention of Fraud (16–17 Oct)'
    const out = await enforceGroundedList({
      reply,
      sources: SOURCES,
      regenerate: async () => {
        called = true
        return ''
      },
    })
    expect(out).toEqual({ reply, caught: [], rewritten: false })
    expect(called).toBe(false)
  })

  it('repeats what the look-ups returned, since the rewrite has no tools', () => {
    expect(groundingCorrection(['- X Y'], ['{"forms":[]}'])).toContain('LOOK-UP RESULTS ALREADY FETCHED THIS TURN')
  })
})
