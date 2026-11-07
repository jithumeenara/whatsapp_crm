import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { closingFields, isDealStatus } from './closing'

const NOW = new Date('2026-11-07T10:00:00Z')

describe('deal closing fields', () => {
  it('a win records when and by whom, and clears any loss', () => {
    expect(closingFields({ status: 'open' }, 'won', 'u1', NOW)).toEqual({ won_at: NOW, lost_at: null, lost_reason: null, closed_by: 'u1' })
  })

  it('a loss records when and by whom, and clears any win', () => {
    expect(closingFields({ status: 'won', won_at: NOW }, 'lost', 'u1', NOW)).toEqual({ lost_at: NOW, won_at: null, closed_by: 'u1' })
  })

  it('reopening clears every closing field', () => {
    expect(closingFields({ status: 'lost', lost_at: NOW }, 'open', 'u1', NOW)).toEqual({ won_at: null, lost_at: null, lost_reason: null, closed_by: null })
  })

  it('an edit that keeps the status keeps the day it was won', () => {
    expect(closingFields({ status: 'won', won_at: NOW }, 'won', 'u2', NOW)).toEqual({})
  })

  it('a deal created already won is stamped', () => {
    expect(closingFields(null, 'won', 'u1', NOW)).toMatchObject({ won_at: NOW, closed_by: 'u1' })
  })

  it('only open, won and lost are statuses', () => {
    expect(isDealStatus('won')).toBe(true)
    expect(isDealStatus('closed')).toBe(false)
    expect(isDealStatus(undefined)).toBe(false)
  })
})
