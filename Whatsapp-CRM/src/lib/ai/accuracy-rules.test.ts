import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  DEFAULT_ACCURACY_RULES,
  accuracyPromptBlock,
  checkAccuracyRules,
  correctionFor,
  mergeRuleBreaches,
  parseAccuracyRules,
  suggestedTopics,
} from './accuracy-rules'
import { businessUnderstanding, formatCompanyBlock } from './company-profile'

describe('accuracy rules', () => {
  it('distrusts what is stored and keeps what is valid', () => {
    const r = parseAccuracyRules({
      answer_mode: 'loose',
      price_policy: 'never',
      sensitive_topics: ['medical', 'astrology', 'medical'],
      blocked_phrases: ['  guaranteed ', 'x', 'Guaranteed', 42],
      on_unsupported: 'handoff',
    })
    expect(r.answer_mode).toBe('balanced')
    expect(r.price_policy).toBe('never')
    expect(r.sensitive_topics).toEqual(['medical'])
    expect(r.blocked_phrases).toEqual(['guaranteed', 'Guaranteed'])
    expect(r.on_unsupported).toBe('handoff')
    expect(parseAccuracyRules(null)).toEqual(DEFAULT_ACCURACY_RULES)
  })

  it('catches a blocked phrase as a whole word, in any case', () => {
    const rules = { ...DEFAULT_ACCURACY_RULES, blocked_phrases: ['free', '100% placement'] }
    expect(checkAccuracyRules('Admission is FREE today', rules)).toEqual([{ kind: 'blocked_phrase', value: 'free' }])
    expect(checkAccuracyRules('We value your freedom', rules)).toEqual([])
    expect(checkAccuracyRules('We offer 100% placement support', rules)).toEqual([{ kind: 'blocked_phrase', value: '100% placement' }])
  })

  it('catches any currency when prices are never quoted, and nothing otherwise', () => {
    const never = { ...DEFAULT_ACCURACY_RULES, price_policy: 'never' as const }
    for (const text of ['It is ₹4,500', 'Rs. 300 only', 'costs $20', 'AED 150 per night', 'fee 1,200 rupees', '500/- per month', '€9.99']) {
      expect(checkAccuracyRules(text, never).map((b) => b.kind)).toContain('price')
    }
    expect(checkAccuracyRules('Classes run 3 days a week, 10 seats left', never)).toEqual([])
    expect(checkAccuracyRules('It is ₹4,500', DEFAULT_ACCURACY_RULES)).toEqual([])
  })

  it('writes the rules the account chose into the prompt', () => {
    const block = accuracyPromptBlock({ ...DEFAULT_ACCURACY_RULES, answer_mode: 'strict', price_policy: 'never', sensitive_topics: ['medical'], blocked_phrases: ['cheap'] })
    expect(block).toContain('Answer ONLY from')
    expect(block).toContain('Never state a price')
    expect(block).toContain('Health & medical')
    expect(block).toContain('"cheap"')
  })

  it('names exactly what to leave out on the retry', () => {
    const c = correctionFor([{ kind: 'blocked_phrase', value: 'free' }, { kind: 'price', value: '₹500' }], ['9876'])
    expect(c).toContain('9876')
    expect(c).toContain('"free"')
    expect(c).toContain('Do not state any price')
  })

  it('adds breaches to the validator result so one decision covers both', () => {
    expect(mergeRuleBreaches(null, [])).toBeNull()
    const merged = mergeRuleBreaches({ ok: true, issues: [], summary: null }, [{ kind: 'price', value: '$5' }])
    expect(merged?.ok).toBe(false)
    expect(merged?.issues[0]).toMatchObject({ kind: 'price', value: '$5' })
  })

  it('suggests the regulated topics an industry has', () => {
    expect(suggestedTopics('Healthcare & Medical')).toEqual(['medical'])
    expect(suggestedTopics('Financial Services')).toEqual(['financial'])
    expect(suggestedTopics('Education & Training')).toEqual(['guarantees'])
    expect(suggestedTopics('Food & Beverage')).toEqual([])
  })
})

describe('what the AI knows about the business', () => {
  it('scores the profile and says what each gap costs', () => {
    const { items, score } = businessUnderstanding({ display_name: 'Acme', working_hours: '9-6' })
    expect(items.find((i) => i.key === 'display_name')?.filled).toBe(true)
    expect(items.find((i) => i.key === 'policies')).toMatchObject({ filled: false })
    expect(score).toBeGreaterThan(0)
    expect(businessUnderstanding(null).score).toBe(0)
  })

  it('gives the AI the new policy details, and what is not offered said plainly', () => {
    const block = formatCompanyBlock({ display_name: 'Acme', payment_methods: 'UPI', policies: 'No refunds', not_offered: 'Home visits' }, 'customer')
    expect(block).toContain('Payment methods accepted: UPI')
    expect(block).toContain('No refunds')
    expect(block).toContain('NOT offered')
  })
})
