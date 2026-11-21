import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ reply: 'Which course do you mean? Fees differ by course.', fail: false }))
vi.mock('@/lib/ai/providers/registry', () => ({
  generateAiReplyWithFallback: async () => {
    if (h.fail) throw new Error('quota')
    return { reply: h.reply, usedProvider: 'gemini', usedModel: 'm' }
  },
}))

import { CLARIFY_SOURCE, FALLBACK_CLARIFY, cleanClarify, clarifySystemPrompt, makeClarifyingQuestion, shouldAskToClarify } from './clarify'

const now = new Date('2026-11-21T10:00:00Z')
const ago = (min: number) => new Date(now.getTime() - min * 60000)

describe('shouldAskToClarify', () => {
  it('asks the first time the assistant is not sure it understood', () => {
    expect(shouldAskToClarify({ reason: 'low_confidence', conversationStatus: 'open', lastAssistant: null, now })).toBe(true)
    expect(shouldAskToClarify({ reason: 'low_confidence', conversationStatus: 'open', lastAssistant: { bot_source: 'ai_auto_reply', created_at: ago(5) }, now })).toBe(true)
  })

  it('never asks twice in a row: the second time it hands over', () => {
    expect(shouldAskToClarify({ reason: 'low_confidence', conversationStatus: 'open', lastAssistant: { bot_source: CLARIFY_SOURCE, created_at: ago(3) }, now })).toBe(false)
  })

  it('a question asked more than a day ago does not count', () => {
    expect(shouldAskToClarify({ reason: 'low_confidence', conversationStatus: 'open', lastAssistant: { bot_source: CLARIFY_SOURCE, created_at: ago(25 * 60) }, now })).toBe(true)
  })

  it('only for "not understood": safety, unsupported figures and errors go straight to a person', () => {
    for (const reason of ['safety', 'unsupported_details', 'model_requested', 'generation_failed']) {
      expect(shouldAskToClarify({ reason, conversationStatus: 'open', lastAssistant: null, now })).toBe(false)
    }
  })

  it('not when the conversation is already with the team', () => {
    expect(shouldAskToClarify({ reason: 'low_confidence', conversationStatus: 'pending', lastAssistant: null, now })).toBe(false)
  })
})

describe('the question', () => {
  it('is asked in the customer’s own language and never answers or promises', () => {
    const p = clarifySystemPrompt()
    expect(p).toMatch(/same language and script/)
    expect(p).toMatch(/Manglish/)
    expect(p).toMatch(/Do not answer/)
  })

  it('is cut to two sentences of plain text', () => {
    expect(cleanClarify('**Which course?** Fees differ. Also batches differ. More.')).toBe('Which course? Fees differ.')
  })

  it('falls back to a plain question when the model fails or says nothing', async () => {
    h.fail = true
    expect((await makeClarifyingQuestion({ temperature: 0.7, max_tokens: 500, active_provider: 'gemini', fallback_provider: null, provider_keys: {} }, 'fees?', [])).text).toBe(FALLBACK_CLARIFY)
    h.fail = false
    h.reply = '   '
    expect((await makeClarifyingQuestion({ temperature: 0.7, max_tokens: 500, active_provider: 'gemini', fallback_provider: null, provider_keys: {} }, 'fees?', [])).text).toBe(FALLBACK_CLARIFY)
  })
})
