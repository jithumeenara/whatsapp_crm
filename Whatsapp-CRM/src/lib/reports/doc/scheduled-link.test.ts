import { describe, expect, it, vi } from 'vitest'

vi.mock('./reports/all', () => ({ allReport: vi.fn() }))
vi.mock('./reports/leads', () => ({ leadReport: vi.fn() }))
vi.mock('./reports/agents', () => ({ agentReport: vi.fn() }))
vi.mock('./reports/sales', () => ({ salesReport: vi.fn() }))
vi.mock('./reports/spending', () => ({ spendingReport: vi.fn() }))
vi.mock('./reports/ads', () => ({ adReport: vi.fn() }))
vi.mock('./reports/guide', () => ({ guideReport: vi.fn() }))
vi.mock('./reports/campaigns', () => ({ campaignReport: vi.fn() }))
vi.mock('./reports/conversations', () => ({ conversationReport: vi.fn() }))
vi.mock('./reports/automation', () => ({ automationReport: vi.fn() }))

import { scheduledLinkFor } from './registry'

describe('the Scheduled menu link', () => {
  it('owners and admins only; it is a page, not a report, so no exports', () => {
    expect(scheduledLinkFor({ role: 'agent' })).toEqual([])
    expect(scheduledLinkFor({ role: 'supervisor' })).toEqual([])
    expect(scheduledLinkFor({ role: 'admin' })).toEqual([{ key: 'scheduled', title: 'Scheduled', group: 'analysis', path: '/reports/scheduled', exports: [], tabs: ['report'] }])
    expect(scheduledLinkFor({ role: 'owner' })).toHaveLength(1)
  })
})
