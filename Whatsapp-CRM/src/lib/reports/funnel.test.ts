import { describe, expect, it } from 'vitest'
import { countFunnel } from './funnel'
import type { FunnelStage } from './settings'

const STAGES: FunnelStage[] = [
  { key: 'appointment', label: 'Appointment', outcome: 'open' },
  { key: 'visited', label: 'Visited', outcome: 'open' },
  { key: 'surgery', label: 'Surgery', outcome: 'won' },
  { key: 'not_going', label: 'Not going ahead', outcome: 'lost' },
]
const count = (rows: ReturnType<typeof countFunnel>) => Object.fromEntries(rows.map((r) => [r.key, r.count]))

describe('funnel counting', () => {
  it('a skipped step still counts as passed', () => {
    const rows = countFunnel(STAGES, [{ id: 'a', won: false }], [{ leadId: 'a', stageKey: 'surgery' }])
    expect(count(rows)).toEqual({ appointment: 1, visited: 1, surgery: 1, not_going: 0 })
  })

  it('counts each lead once, at its furthest stage', () => {
    const rows = countFunnel(
      STAGES,
      [{ id: 'a', won: false }, { id: 'b', won: false }, { id: 'c', won: false }],
      [
        { leadId: 'a', stageKey: 'appointment' }, { leadId: 'a', stageKey: 'visited' }, { leadId: 'a', stageKey: 'visited' },
        { leadId: 'b', stageKey: 'appointment' },
      ],
    )
    expect(count(rows)).toEqual({ appointment: 2, visited: 1, surgery: 0, not_going: 0 })
  })

  it('a lead won through the close dialog reaches the won stage', () => {
    expect(count(countFunnel(STAGES, [{ id: 'a', won: true }], []))).toMatchObject({ appointment: 1, surgery: 1 })
  })

  it('lost stages are counted on their own, not as a step', () => {
    const rows = countFunnel(STAGES, [{ id: 'a', won: false }], [{ leadId: 'a', stageKey: 'appointment' }, { leadId: 'a', stageKey: 'not_going' }])
    expect(count(rows)).toEqual({ appointment: 1, visited: 0, surgery: 0, not_going: 1 })
  })

  it('ignores marks for leads outside the period and stages that no longer exist', () => {
    const rows = countFunnel(STAGES, [{ id: 'a', won: false }], [{ leadId: 'z', stageKey: 'visited' }, { leadId: 'a', stageKey: 'old_stage' }])
    expect(count(rows)).toEqual({ appointment: 0, visited: 0, surgery: 0, not_going: 0 })
  })
})
