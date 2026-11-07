/**
 * How far this period's leads got through the business's own funnel.
 * Pure, so the counting rule is tested on its own.
 *
 * "Reached" means the furthest stage a lead got to: a lead marked
 * Surgery without ever being marked Visited still counts as visited,
 * because a skipped step was still passed (counting only marked steps is
 * what makes other CRMs' funnels go wrong when people skip one). A lead
 * won through the close dialog counts as reaching the last won stage.
 * Lost stages are not a step on the way: they are counted on their own.
 */

import type { FunnelStage } from './settings'

export interface FunnelRow extends FunnelStage { count: number }

export function countFunnel(
  stages: FunnelStage[],
  leads: Array<{ id: string; won: boolean }>,
  marks: Array<{ leadId: string; stageKey: string }>,
): FunnelRow[] {
  const path = stages.filter((s) => s.outcome !== 'lost')
  const index = new Map(path.map((s, i) => [s.key, i]))
  const lastWon = path.map((s) => s.outcome).lastIndexOf('won')
  const furthest = new Map<string, number>()
  const lostHit = new Map<string, Set<string>>()
  const inCohort = new Set(leads.map((l) => l.id))

  for (const m of marks) {
    if (!inCohort.has(m.leadId)) continue
    const i = index.get(m.stageKey)
    if (i !== undefined) furthest.set(m.leadId, Math.max(furthest.get(m.leadId) ?? -1, i))
    else if (stages.some((s) => s.key === m.stageKey && s.outcome === 'lost')) {
      const set = lostHit.get(m.stageKey) ?? new Set<string>()
      set.add(m.leadId)
      lostHit.set(m.stageKey, set)
    }
  }
  if (lastWon >= 0) {
    for (const l of leads) if (l.won) furthest.set(l.id, Math.max(furthest.get(l.id) ?? -1, lastWon))
  }

  return stages.map((s) => {
    if (s.outcome === 'lost') return { ...s, count: lostHit.get(s.key)?.size ?? 0 }
    const i = index.get(s.key) as number
    let count = 0
    for (const v of furthest.values()) if (v >= i) count++
    return { ...s, count }
  })
}
