import { describe, it, expect } from 'vitest'
import { buildCustomerSystemPrompt } from './customer-pipeline'
import type { CustomerAiConfig } from './customer-pipeline'

/**
 * A WhatsApp Flow submitted with no chatbot step after it: the assistant
 * is the only thing that can tell the customer it arrived.
 */

const aiConfig = {
  ai_auto_reply_enabled: true,
  active_provider: 'gemini',
  system_prompt: 'You are the assistant for a training institute.',
  reply_language: null,
} as unknown as CustomerAiConfig

const base = {
  aiConfig,
  accountId: 'acc-1',
  contactId: 'contact-1',
  customerMessage: 'Submitted the form:\n• Training programe: PSC\n• From date: 2026-10-01',
  selected: { qaPairs: [], documentChunks: [], confidence: 0 },
  toolsAvailable: false,
}

describe('formSubmission', () => {
  it('asks for a confirmation that repeats the details back', async () => {
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, formSubmission: true })
    expect(systemPrompt).toMatch(/JUST SUBMITTED A FORM/)
    expect(systemPrompt).toMatch(/confirm it was received/i)
    expect(systemPrompt).toMatch(/Repeat the key details back/i)
  })

  it('keeps ID numbers out of the reply and next steps honest', async () => {
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, formSubmission: true })
    expect(systemPrompt).toMatch(/Never repeat an ID number such as Aadhaar/i)
    expect(systemPrompt).toMatch(/Never invent a next step, a fee or a date/i)
  })

  it('does not take the reply language from the form labels', async () => {
    const form = await buildCustomerSystemPrompt({ ...base, formSubmission: true })
    expect(form.systemPrompt).toMatch(/language the customer used earlier/i)
  })

  it('changes nothing for an ordinary message', async () => {
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, customerMessage: 'hello' })
    expect(systemPrompt).not.toMatch(/JUST SUBMITTED A FORM/)
  })
})
