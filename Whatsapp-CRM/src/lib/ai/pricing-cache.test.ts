import { describe, expect, it } from 'vitest'
import { CACHED_INPUT_SHARE, estimateCostUsd, tokensFromGemini } from './pricing'

/**
 * Bug: tokens Gemini served from its cache were charged at the full input
 * rate, so the Usage tab overstated the bill (more so since the prompt's
 * business part is reused). Cached input is billed at 10% of input.
 */
describe('cached input tokens', () => {
  it('are read from usageMetadata, never more than the prompt', () => {
    expect(tokensFromGemini({ promptTokenCount: 1000, candidatesTokenCount: 100, cachedContentTokenCount: 800 }).cachedInputTokens).toBe(800)
    expect(tokensFromGemini({ promptTokenCount: 100, cachedContentTokenCount: 999 }).cachedInputTokens).toBe(100)
    expect(tokensFromGemini({ promptTokenCount: 100 }).cachedInputTokens).toBeUndefined()
  })

  it('cost less: the cached part at 10% of the input rate', () => {
    const model = 'gemini-2.5-flash'
    const full = estimateCostUsd(model, { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 })
    const cached = estimateCostUsd(model, { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: 1_000_000 })
    expect(full).toBeGreaterThan(0)
    expect(cached).toBeCloseTo(full * CACHED_INPUT_SHARE, 6)
  })

  it('no cached tokens: the same cost as before', () => {
    const t = { inputTokens: 5000, outputTokens: 700, totalTokens: 5700 }
    expect(estimateCostUsd('gemini-2.5-flash', t)).toBe(estimateCostUsd('gemini-2.5-flash', { ...t, cachedInputTokens: 0 }))
  })
})
