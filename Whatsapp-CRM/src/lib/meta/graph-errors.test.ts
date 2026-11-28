import { describe, expect, it } from 'vitest'
import { isAppDenied } from './graph-errors'

// Connect Ads / Catalog that found nothing said "tick your ad accounts"
// even when Meta had refused the app itself (no ads_management access) —
// the owner ticked boxes again and again for nothing.

describe('isAppDenied', () => {
  it('permission / access-level errors are the app being refused', () => {
    expect(isAppDenied([{ code: 200 }])).toBe(true)
    expect(isAppDenied([{ code: 10 }])).toBe(true)
    expect(isAppDenied([{ code: 3 }])).toBe(true)
    expect(isAppDenied([{ code: 100 }, { code: 294 }])).toBe(true)
  })

  it('anything else is not', () => {
    expect(isAppDenied([])).toBe(false)
    expect(isAppDenied([{ code: 100 }, { code: 190 }, {}])).toBe(false)
  })
})
