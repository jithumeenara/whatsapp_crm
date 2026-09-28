import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const findUnique = vi.fn(async () => null)
vi.mock('@/lib/db', () => ({ prisma: { aiConfig: { findUnique: () => findUnique() } } }))
vi.mock('./train-pending', () => ({ trainKnowledgeConfig: vi.fn() }))

import { REFRESH_DELAY_MS, scheduleKnowledgeRefresh } from './knowledge-refresh'

describe('refreshing knowledge after an edit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    findUnique.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('runs once for a burst of edits, a little later', async () => {
    scheduleKnowledgeRefresh('acc-1', 'table-a')
    scheduleKnowledgeRefresh('acc-1', 'table-b')
    scheduleKnowledgeRefresh('acc-1')
    expect(findUnique).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS + 10)
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('keeps accounts apart', async () => {
    scheduleKnowledgeRefresh('acc-2')
    scheduleKnowledgeRefresh('acc-3')
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS + 10)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('schedules again after a run', async () => {
    scheduleKnowledgeRefresh('acc-4')
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS + 10)
    scheduleKnowledgeRefresh('acc-4')
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS + 10)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })
})
