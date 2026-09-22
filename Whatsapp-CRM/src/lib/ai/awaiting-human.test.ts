import { describe, it, expect } from 'vitest'
import { buildCustomerSystemPrompt } from './customer-pipeline'
import type { CustomerAiConfig } from './customer-pipeline'

/**
 * The instruction that stops the assistant selling to somebody who has
 * already been promised a phone call.
 *
 * The bug it exists for, from a live account: a customer wrote "please
 * call me", was told a colleague would ring them back, then said "I am
 * retired from service" — and was asked whether they wanted details of
 * the training programmes. The business promised a call and then
 * started selling, to somebody who had just said they no longer work.
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
  customerMessage: 'I am retired from service',
  // Nothing retrieved. The block under test does not depend on
  // knowledge, and an empty context keeps the assertion about the one
  // thing that changed.
  selected: { qaPairs: [], documentChunks: [], confidence: 0 },
  toolsAvailable: false,
}

describe('awaitingHuman', () => {
  it('tells the assistant to stop offering things', async () => {
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, awaitingHuman: true })

    // The specific instruction, not merely "some extra text". The whole
    // point is that it may not suggest a course to a retired person.
    expect(systemPrompt).toMatch(/passed to a colleague/i)
    expect(systemPrompt).toMatch(/Do NOT ask a question/i)
    expect(systemPrompt).toMatch(/Do NOT offer or suggest any service, product, course or programme/i)
  })

  it('says why a question is wrong, not just that it is', async () => {
    // A question invites a reply nobody is there to answer, which is
    // how a "we'll call you" thread turns into the assistant holding a
    // conversation on its own.
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, awaitingHuman: true })
    expect(systemPrompt).toMatch(/colleague will be in touch/i)
  })

  it('changes nothing when nobody is waiting', async () => {
    const normal = await buildCustomerSystemPrompt({ ...base, awaitingHuman: false })
    const unset = await buildCustomerSystemPrompt({ ...base })

    expect(normal.systemPrompt).not.toMatch(/passed to a colleague/i)
    expect(unset.systemPrompt).not.toMatch(/passed to a colleague/i)
    // Absent and explicitly false are the same thing, so a caller that
    // has not been updated behaves exactly as before.
    expect(normal.systemPrompt).toBe(unset.systemPrompt)
  })

  it('keeps the business\'s own instructions', async () => {
    // The block is added, not substituted. An assistant that forgot who
    // it worked for would acknowledge in the wrong voice.
    const { systemPrompt } = await buildCustomerSystemPrompt({ ...base, awaitingHuman: true })
    expect(systemPrompt).toContain('training institute')
  })
})
