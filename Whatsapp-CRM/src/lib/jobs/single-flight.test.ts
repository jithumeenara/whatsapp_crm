import { describe, expect, it } from 'vitest'
import { singleFlight } from './single-flight'

describe('singleFlight', () => {
  it('skips a tick while the last run is still going, then runs again', async () => {
    let runs = 0
    let release: () => void = () => {}
    const job = singleFlight(async () => {
      runs++
      await new Promise<void>((r) => { release = r })
    })
    const first = job()
    await job() // arrives mid-run: skipped
    expect(runs).toBe(1)
    release()
    await first
    const third = job()
    expect(runs).toBe(2)
    release()
    await third
  })

  it('a failed run does not block the next one', async () => {
    let runs = 0
    const job = singleFlight(async () => {
      runs++
      throw new Error('boom')
    })
    await expect(job()).rejects.toThrow('boom')
    await expect(job()).rejects.toThrow('boom')
    expect(runs).toBe(2)
  })
})
