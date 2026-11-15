import { describe, expect, it } from 'vitest'
import { flowFunnels, summariseHandovers, topQuestions } from './automation-data'

describe('summariseHandovers', () => {
  it('counts by reason and source, outside hours, and how fast a person took over', () => {
    const s = summariseHandovers([
      { reason: 'low_confidence', source: 'ai', outside: false, takenMin: 10, takenBy: 'u1' },
      { reason: 'low_confidence', source: 'flow', outside: true, takenMin: 50, takenBy: 'u2' },
      { reason: 'asked_for_person', source: 'ai', outside: true, takenMin: null, takenBy: null },
    ])
    expect(s).toMatchObject({ total: 3, outside: 2, taken: 2, notTaken: 1, takenMedian: 30 })
    expect(s.byReason).toEqual([{ reason: 'low_confidence', n: 2 }, { reason: 'asked_for_person', n: 1 }])
    expect(s.bySource).toEqual({ ai: 2, flow: 1 })
  })
})

describe('topQuestions', () => {
  it('same question asked again counts once more, not as a new line; newest wording kept', () => {
    const q = topQuestions([
      { text: 'What are the fees?', at: '2026-11-10' },
      { text: '  what are the FEES? ', at: '2026-11-12' },
      { text: 'Do you open on Sunday', at: '2026-11-11' },
      { text: '', at: '2026-11-11' },
    ])
    expect(q[0]).toMatchObject({ times: 2, last: '2026-11-12' })
    expect(q).toHaveLength(2)
  })
})

describe('flowFunnels', () => {
  it('per flow: started, finished, handed over, stopped, and the step where most stopped', () => {
    const f = flowFunnels([
      { flow: 'f1', name: 'Admission', status: 'completed', endReason: null, node: null },
      { flow: 'f1', name: 'Admission', status: 'handed_off', endReason: 'handoff_node', node: 'h1' },
      { flow: 'f1', name: 'Admission', status: 'timed_out', endReason: 'timeout', node: 'ask_course' },
      { flow: 'f1', name: 'Admission', status: 'timed_out', endReason: 'timeout', node: 'ask_course' },
      { flow: 'f2', name: 'Feedback', status: 'active', endReason: null, node: 'q1' },
    ])
    const a = f.find((x) => x.flow === 'f1')!
    expect(a).toMatchObject({ started: 4, finished: 1, handedOver: 1, stopped: 2, worstStep: 'ask_course', worstStepCount: 2 })
    expect(f[0].flow).toBe('f1')
    expect(f.find((x) => x.flow === 'f2')).toMatchObject({ started: 1, running: 1 })
  })
})
