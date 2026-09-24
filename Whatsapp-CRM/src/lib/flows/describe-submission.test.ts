import { describe, it, expect } from 'vitest'
import { describeFlowSubmission, FORM_SUBMITTED_PREFIX } from './describe-submission'

describe('describeFlowSubmission', () => {
  it('writes each answer on its own line under readable labels', () => {
    const text = describeFlowSubmission({ training_programe: 'PSC Coaching', from_date: '2026-10-01', to_date: '2026-10-05' })
    expect(text).toBe(
      `${FORM_SUBMITTED_PREFIX}\n• Training programe: PSC Coaching\n• From date: 2026-10-01\n• To date: 2026-10-05`,
    )
  })

  it('shows an answer once when it came under both names', () => {
    const text = describeFlowSubmission({ comp_12: 'PSC Coaching', training_programe: 'PSC Coaching' })!
    expect(text.match(/PSC Coaching/g)).toHaveLength(1)
    expect(text).toContain('Training programe')
  })

  it('keeps an internal name when it is the only place the answer is', () => {
    expect(describeFlowSubmission({ input_comp_359: 'Kollam' })).toContain('Kollam')
  })

  it('masks an Aadhaar number to its last four digits', () => {
    const text = describeFlowSubmission({ aaadhaar_no: '1234 5678 9012' })!
    expect(text).toContain('XXXX XXXX 9012')
    expect(text).not.toContain('5678')
  })

  it('leaves out the token, empty answers and markers', () => {
    expect(describeFlowSubmission({ flow_token: 'abc', __target_screen: 'X', name: '' })).toBeNull()
  })

  it('joins a multi-choice answer', () => {
    expect(describeFlowSubmission({ topics: ['A', 'B'] })).toContain('• Topics: A, B')
  })
})
