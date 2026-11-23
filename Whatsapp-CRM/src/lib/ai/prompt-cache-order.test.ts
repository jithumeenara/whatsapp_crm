import { describe, expect, it } from 'vitest'
import { buildCustomerSystemPrompt, type CustomerAiConfig } from './customer-pipeline'

/**
 * The prompt opened with today's time and this customer's details, so no
 * two requests shared an opening and the provider could never reuse work
 * on it (implicit caching). What is the same for every customer of the
 * business now comes first; the time, the customer and the knowledge for
 * this question follow.
 */

const aiConfig = {
  ai_auto_reply_enabled: true,
  active_provider: 'gemini',
  system_prompt: 'You are the assistant for Example Clinic.',
  reply_language: null,
  fallback_answer: 'I will check with the team.',
} as unknown as CustomerAiConfig

const sources = (now: string, customer: string) => ({
  companyBlock: 'COMPANY: Example Clinic, Kochi.',
  customerContext: customer,
  toolInstruction: '',
  nowBlock: now,
  timezone: 'Asia/Kolkata',
  accuracyRules: undefined,
  preferredLanguage: null,
}) as never

const build = (now: string, customer: string, message: string, knowledge: string) =>
  buildCustomerSystemPrompt({
    aiConfig,
    accountId: 'acc-1',
    contactId: 'c1',
    customerMessage: message,
    selected: { qaPairs: [], documentChunks: [{ title: 'Doc', text: knowledge, sourceId: 'd1' }], confidence: 0.9 },
    toolsAvailable: false,
    sources: sources(now, customer),
  })

describe('prompt order for caching', () => {
  it('two customers at two moments share the whole business part of the prompt', async () => {
    const a = (await build('NOW: 10:00', 'CUSTOMER: Anu', 'What are your hours?', 'Open 9 to 5.')).systemPrompt
    const b = (await build('Later: 10:07', 'Someone: Ravi', 'Price of a checkup?', 'Checkup costs 500.')).systemPrompt
    expect(a.startsWith('COMPANY: Example Clinic')).toBe(true)
    let shared = 0
    while (shared < a.length && a[shared] === b[shared]) shared++
    // The time, the customer and the knowledge all come after the shared part.
    expect(a.indexOf('NOW: 10:00')).toBeGreaterThanOrEqual(shared)
    expect(a.indexOf('CUSTOMER: Anu')).toBeGreaterThanOrEqual(shared)
    expect(a.indexOf('Open 9 to 5.')).toBeGreaterThanOrEqual(shared)
    // …and the business's own prompt and rules are inside it.
    expect(a.slice(0, shared)).toContain('You are the assistant for Example Clinic.')
    expect(a.slice(0, shared)).toContain('I will check with the team.')
  })

  it('nothing was dropped: every part is still in the prompt', async () => {
    const p = (await build('NOW: 10:00', 'CUSTOMER: Anu', 'hi', 'Open 9 to 5.')).systemPrompt
    for (const part of ['COMPANY: Example Clinic', 'You are the assistant', 'NOW: 10:00', 'CUSTOMER: Anu', 'Open 9 to 5.']) {
      expect(p).toContain(part)
    }
  })
})
