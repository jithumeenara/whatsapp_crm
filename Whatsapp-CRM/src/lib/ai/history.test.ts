import { describe, it, expect } from 'vitest'
import { historyTurns, withoutUnsupported } from './history'

// The reply from 28 Sep, and what its explanation found in no source.
const REPLY = [
  'ഞങ്ങളുടെ സ്ഥാപനത്തിൽ പ്രധാനമായും താഴെ പറയുന്ന പരിശീലന പ്രോഗ്രാമുകളാണ് ഉള്ളത്:',
  '',
  '- *Statutory Training Programme (STP)* (സബ് സ്റ്റാഫ്, മിനിസ്റ്റീരിയൽ, സൂപ്പർവൈസറി ജീവനക്കാർക്ക്)',
  '- *Leadership and Good Governance (Rule 50 A)* (ഡയറക്ടർ ബോർഡ് അംഗങ്ങൾക്ക്)',
  '- *Business Development Plan (Recovery / NPA Management / KYC)*',
  '- *Gold Loan Appraisal & Fraud Prevention* (എല്ലാ വിഭാഗം ജീവനക്കാർക്കും)',
].join('\n')
const UNSUPPORTED = [
  'Leadership and Good Governance (Rule 50 A) (ഡയറക്ടർ ബോർഡ് അംഗങ്ങൾക്ക്)',
  'Business Development Plan (Recovery / NPA Management / KYC)',
]

describe('what the assistant is shown of its own replies', () => {
  it('leaves out the lines found in no source', () => {
    const cleaned = withoutUnsupported(REPLY, UNSUPPORTED)
    expect(cleaned).not.toContain('Leadership')
    expect(cleaned).not.toContain('Business Development')
    expect(cleaned).toContain('Statutory Training Programme')
    expect(cleaned).toContain('Gold Loan Appraisal')
  })

  it('marks its own turns, and only its own', () => {
    const turns = historyTurns([
      { sender_type: 'customer', content_text: 'ഏതൊക്കെ ട്രെയിനിങ്?' },
      { sender_type: 'bot', bot_source: 'ai_auto_reply', content_text: REPLY, ai_meta: { unsupported: UNSUPPORTED } },
      { sender_type: 'agent', content_text: 'Fee is 5900 for STP (M).' },
      { sender_type: 'bot', bot_source: 'chatbot', content_text: 'Welcome! Choose an option.' },
    ])
    expect(turns.map((t) => [t.role, Boolean(t.byAssistant)])).toEqual([
      ['user', false],
      ['model', true],
      ['model', false],
      ['model', false],
    ])
    expect(turns[1].text).not.toContain('Leadership')
  })

  it('keeps a reply with no explanation as it was', () => {
    const turns = historyTurns([{ sender_type: 'bot', bot_source: 'ai_auto_reply', content_text: REPLY }])
    expect(turns[0].text).toBe(REPLY)
    expect(turns[0].byAssistant).toBe(true)
  })
})
