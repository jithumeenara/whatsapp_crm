import { describe, expect, it, vi } from 'vitest'

// The builders reach the database; only the access rules are compared.
vi.mock('../doc/reports/all', () => ({ allReport: vi.fn() }))
vi.mock('../doc/reports/leads', () => ({ leadReport: vi.fn() }))
vi.mock('../doc/reports/agents', () => ({ agentReport: vi.fn() }))
vi.mock('../doc/reports/sales', () => ({ salesReport: vi.fn() }))
vi.mock('../doc/reports/spending', () => ({ spendingReport: vi.fn() }))
vi.mock('../doc/reports/ads', () => ({ adReport: vi.fn() }))
vi.mock('../doc/reports/guide', () => ({ guideReport: vi.fn() }))
vi.mock('../doc/reports/campaigns', () => ({ campaignReport: vi.fn() }))
vi.mock('../doc/reports/conversations', () => ({ conversationReport: vi.fn() }))
vi.mock('../doc/reports/automation', () => ({ automationReport: vi.fn() }))

import { REPORTS } from '../doc/registry'
import { SCHEDULABLE, recipientMayGet } from './rules'

describe('schedule roles match the registry', () => {
  it('every report a schedule may send exists, and needs supervisor+ (admin+ for money), never less than the registry asks', () => {
    const keys = new Set(REPORTS.map((r) => r.key))
    for (const k of SCHEDULABLE) expect(keys.has(k), k).toBe(true)
    for (const def of REPORTS) {
      if (!SCHEDULABLE.includes(def.key)) continue
      const needsAdmin = def.money || def.minRole === 'admin' || def.minRole === 'owner'
      expect(recipientMayGet(def.key, 'supervisor'), def.key).toBe(!needsAdmin)
      expect(recipientMayGet(def.key, 'admin'), def.key).toBe(def.minRole !== 'owner')
      expect(recipientMayGet(def.key, 'agent'), def.key).toBe(false)
    }
  })
})
