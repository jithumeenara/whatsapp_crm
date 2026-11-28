import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding } from '../doc/types'

const h = vi.hoisted(() => ({ key: 'k' as string | null, calls: 0, prompts: [] as string[], answer: '{}', fail: false }))

vi.mock('@/lib/db', () => ({ prisma: { aiConfig: { findUnique: () => Promise.resolve({ provider_keys: {} }) } } }))
vi.mock('@/lib/ai/providers/registry', () => ({ geminiCredentials: () => ({ apiKey: h.key, model: null }) }))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: () => Promise.resolve(), tokensFromGemini: () => ({}) }))
vi.mock('@/lib/ai/reasoning', () => ({ thinkingConfigFor: () => null }))
// The Gemini call, via the new-SDK doorway (src/lib/ai/genai.ts) the code
// now uses; same behaviour as the old-SDK mock it replaces.
vi.mock('@/lib/ai/genai', () => ({
  SchemaType: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY' },
  geminiGenerate: (args: { contents: string }) => {
    h.calls += 1
    h.prompts.push(args.contents)
    if (h.fail) return Promise.reject(new Error('quota'))
    return Promise.resolve({ text: h.answer, usageMetadata: {} })
  },
}))

import { aiGuideFindings } from './generate'

const cards = (n: number): Finding[] => [
  { severity: 'high', code: 'never_contacted', title: `${n} leads were never contacted`, evidence: 'Older than 24 hours.', suggestion: 'Call them.' },
]

beforeEach(() => { h.key = 'k'; h.calls = 0; h.prompts = []; h.fail = false; h.answer = JSON.stringify({ summary: `New leads are waiting.`, actions: ['Call the 27 leads first.', 'Win 40% more next week.'] }) })

describe('aiGuideFindings', () => {
  it('no Gemini key: nothing, and no call', async () => {
    h.key = null
    expect(await aiGuideFindings({ accountId: 'a1', findings: cards(27), language: 'Malayalam' })).toEqual([])
    expect(h.calls).toBe(0)
  })

  it('gives the model only the facts, keeps lines whose numbers are facts, labels them AI, and asks in the business language', async () => {
    const out = await aiGuideFindings({ accountId: 'a2', findings: cards(27), language: 'Malayalam' })
    expect(out.map((x) => x.title)).toEqual(['New leads are waiting.', 'Call the 27 leads first.'])
    expect(out.every((x) => x.byAi)).toBe(true)
    expect(h.prompts[0]).toContain('27 leads were never contacted')
    expect(h.prompts[0]).toContain('Malayalam')
    expect(h.prompts[0]).not.toContain('Call them.') // suggestions are not facts
  })

  it('the same facts again are not paid for twice; new numbers ask again', async () => {
    await aiGuideFindings({ accountId: 'a3', findings: cards(27), language: 'English' })
    await aiGuideFindings({ accountId: 'a3', findings: cards(27), language: 'English' })
    expect(h.calls).toBe(1)
    await aiGuideFindings({ accountId: 'a3', findings: cards(31), language: 'English' })
    expect(h.calls).toBe(2)
  })

  it('a failed call shows the guide without AI', async () => {
    h.fail = true
    expect(await aiGuideFindings({ accountId: 'a4', findings: cards(27), language: 'English' })).toEqual([])
  })
})
