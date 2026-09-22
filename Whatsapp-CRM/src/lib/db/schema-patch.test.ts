import { describe, it, expect, beforeEach } from 'vitest'
import { onceSchemaPatch, __resetSchemaPatchesForTests } from './schema-patch'

beforeEach(() => __resetSchemaPatchesForTests())

describe('onceSchemaPatch', () => {
  it('runs the patch once, however many callers ask', async () => {
    let runs = 0
    const patch = async () => { runs++ }

    await onceSchemaPatch('messages.deleted_at', patch)
    await onceSchemaPatch('messages.deleted_at', patch)
    await onceSchemaPatch('messages.deleted_at', patch)

    expect(runs).toBe(1)
  })

  it('runs once even when the callers arrive together', async () => {
    // This is the real case: several requests land in the same tick and
    // each reaches the guard before the first has finished. Storing the
    // in-flight promise, rather than a "done" flag, is what makes them
    // share one statement instead of issuing one each.
    let runs = 0
    const patch = () => {
      runs++
      return new Promise((r) => setTimeout(r, 20))
    }

    await Promise.all(
      Array.from({ length: 25 }, () => onceSchemaPatch('flows.channel', patch)),
    )

    expect(runs).toBe(1)
  })

  it('shares one run between different routes patching the same column', async () => {
    // Three routes guard messages.deleted_at. Whichever is hit first
    // should cover the other two.
    let runs = 0
    const patch = async () => { runs++ }

    await onceSchemaPatch('messages.deleted_at', patch)   // the read route
    await onceSchemaPatch('messages.deleted_at', patch)   // the timeline
    await onceSchemaPatch('messages.deleted_at', patch)   // the delete route

    expect(runs).toBe(1)
  })

  it('keeps separate patches separate', async () => {
    const runs: string[] = []
    await onceSchemaPatch('a', async () => { runs.push('a') })
    await onceSchemaPatch('b', async () => { runs.push('b') })
    await onceSchemaPatch('a', async () => { runs.push('a') })

    expect(runs).toEqual(['a', 'b'])
  })

  it('lets the next caller retry after a failure', async () => {
    // A database blip at startup must not be replayed to every request
    // for the lifetime of the process — which is what caching the
    // rejected promise would do.
    let attempts = 0
    const flaky = async () => {
      attempts++
      if (attempts === 1) throw new Error('connection reset')
    }

    await expect(onceSchemaPatch('leads.is_hidden', flaky)).rejects.toThrow('connection reset')
    await expect(onceSchemaPatch('leads.is_hidden', flaky)).resolves.toBeUndefined()
    expect(attempts).toBe(2)

    // And once it has succeeded, it settles down again.
    await onceSchemaPatch('leads.is_hidden', flaky)
    expect(attempts).toBe(2)
  })

  it('surfaces the failure rather than hiding it', async () => {
    // Call sites decide whether to swallow. The helper does not decide
    // for them — the leads route wants the error, the message routes
    // catch it themselves.
    await expect(
      onceSchemaPatch('boom', async () => { throw new Error('permission denied') }),
    ).rejects.toThrow('permission denied')
  })
})
