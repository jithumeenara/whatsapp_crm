import { describe, expect, it } from 'vitest'
import { classifyMetaError, classifyMetaErrorCode, failureText, retryRule } from './meta-error-codes'

/**
 * Found 18 Oct: 131049 — Meta holding back a marketing message because the
 * person already got their share from businesses that day — was "unknown",
 * so "Retry failed" sent it straight back into the same wall. And a failure
 * Meta reports later (a status webhook) kept no reason at all.
 */
describe('Meta failures, by what can be done about them', () => {
  it('131049 is the per-person marketing limit', () => {
    expect(classifyMetaErrorCode(131049)).toBe('marketing_limit')
  })

  it('a template Meta will not send is a template problem', () => {
    for (const code of [132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068]) {
      expect(classifyMetaErrorCode(code)).toBe('template_problem')
    }
  })

  it('keeps the existing categories', () => {
    expect(classifyMetaErrorCode(131026)).toBe('recipient_unreachable')
    expect(classifyMetaErrorCode(131050)).toBe('recipient_opted_out')
    expect(classifyMetaErrorCode(130429)).toBe('rate_limited')
    expect(classifyMetaErrorCode(190)).toBe('auth_expired')
  })
})

describe('retrying a failed send', () => {
  it('never for people who cannot or must not get it', () => {
    expect(retryRule('recipient_unreachable')).toBe('never')
    expect(retryRule('recipient_opted_out')).toBe('never')
    expect(retryRule('template_problem')).toBe('never')
  })

  it('only after a day for the marketing limit', () => {
    expect(retryRule('marketing_limit')).toBe('after_24h')
  })

  it('now for passing problems', () => {
    expect(retryRule('rate_limited')).toBe('now')
    expect(retryRule('unknown')).toBe('now')
    expect(retryRule('auth_expired')).toBe('now')
  })
})

describe('a failure Meta reports later', () => {
  it('keeps the reason, in the form the classifier reads back', () => {
    const text = failureText([{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }])
    expect(text).toBe('This message was not delivered to maintain healthy ecosystem engagement. (code 131049)')
    expect(classifyMetaError(text).category).toBe('marketing_limit')
  })

  it('says something plain when Meta gives no detail', () => {
    expect(failureText(undefined)).toBe('Not delivered (WhatsApp gave no reason)')
  })
})
