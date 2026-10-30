import { beforeEach, describe, expect, it } from 'vitest'
import { __bucketCountForTests, __resetRateLimitForTests, checkRateLimit } from './rate-limit'

describe('rate limiter memory', () => {
  beforeEach(() => __resetRateLimitForTests())

  it('distinct keys inside one window do not grow the store without bound', () => {
    for (let i = 0; i < 60_000; i++) checkRateLimit(`web-form:10.${i}`, { limit: 10, windowMs: 600_000 })
    expect(__bucketCountForTests()).toBeLessThanOrEqual(50_000)
  })

  it('a key still in its window keeps counting', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('k', { limit: 3, windowMs: 60_000 })
    expect(checkRateLimit('k', { limit: 3, windowMs: 60_000 }).success).toBe(false)
  })
})
