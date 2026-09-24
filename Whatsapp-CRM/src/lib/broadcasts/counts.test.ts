import { describe, it, expect } from 'vitest'
import { countsFromStatuses } from './counts'

describe('countsFromStatuses', () => {
  it('counts the funnel cumulatively, one state per person', () => {
    // The live case: 23 recipients, 9 delivered only, 11 read, 3 failed.
    const c = countsFromStatuses([
      { status: 'delivered', count: 9 },
      { status: 'read', count: 11 },
      { status: 'failed', count: 3 },
    ])
    expect(c).toEqual({ sent_count: 20, delivered_count: 20, read_count: 11, replied_count: 0, failed_count: 3 })
  })

  it('never counts more people than there are', () => {
    const c = countsFromStatuses([{ status: 'replied', count: 2 }, { status: 'sent', count: 1 }])
    expect(c.sent_count).toBe(3)
    expect(c.replied_count).toBe(2)
  })

  it('leaves pending recipients out of every figure', () => {
    expect(countsFromStatuses([{ status: 'pending', count: 5 }])).toEqual({
      sent_count: 0, delivered_count: 0, read_count: 0, replied_count: 0, failed_count: 0,
    })
  })
})
