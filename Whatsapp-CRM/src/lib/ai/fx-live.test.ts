import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { believable, liveUsdRate, parseRates, resetLiveRatesForTests } from './fx-live'

/** The automatic USD rate: fetched rarely, checked, and never breaks anything when the source fails. */

const ok = (rates: Record<string, number>) => Response.json({ result: 'success', base_code: 'USD', rates: { USD: 1, ...rates } })

beforeEach(() => resetLiveRatesForTests())
afterEach(() => vi.unstubAllGlobals())

describe('parseRates', () => {
  it('keeps only valid codes and numbers', () => {
    expect(parseRates({ result: 'success', base_code: 'USD', rates: { USD: 1, INR: 84.2, bad: 3, AED: 'x', EUR: -1 } })).toEqual({ USD: 1, INR: 84.2 })
  })
  it('rejects anything that is not the expected shape', () => {
    expect(parseRates({ result: 'error' })).toBeNull()
    expect(parseRates({ result: 'success', base_code: 'EUR', rates: { USD: 1 } })).toBeNull()
    expect(parseRates(null)).toBeNull()
  })
})

describe('believable', () => {
  it('a rate far from the suggested one is not used', () => {
    expect(believable('INR', 84)).toBe(true)
    expect(believable('INR', 8.4)).toBe(false)
    expect(believable('INR', 840)).toBe(false)
  })
})

describe('liveUsdRate', () => {
  it('fetches once and reuses the rates', async () => {
    const f = vi.fn(async () => ok({ INR: 84.2, AED: 3.6725 }))
    vi.stubGlobal('fetch', f)
    expect((await liveUsdRate('INR'))?.rate).toBe(84.2)
    expect((await liveUsdRate('AED'))?.rate).toBe(3.6725)
    expect(f).toHaveBeenCalledTimes(1)
    const url = String((f.mock.calls[0] as unknown[])[0])
    expect(url).toBe('https://open.er-api.com/v6/latest/USD')
  })

  it('a failing source gives null (the caller keeps its saved rate), never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(liveUsdRate('INR')).resolves.toBeNull()
  })

  it('an unbelievable number from the source is ignored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ INR: 0.84 })))
    await expect(liveUsdRate('INR')).resolves.toBeNull()
  })
})
