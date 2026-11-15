import { describe, expect, it } from 'vitest'
import { validateSchedule } from './validate'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const team = new Map([[U1, 'owner'], [U2, 'supervisor']])
const ok = { report_key: 'leads', frequency: 'weekly', day: 1, send_hour: 9, recipient_ids: [U1, U2], by_chat: true, by_email: false, enabled: true }

describe('validateSchedule', () => {
  it('copies only known fields, each checked', () => {
    const r = validateSchedule({ ...ok, account_id: 'evil', created_by: 'evil', last_sent_key: 'x' }, team)
    expect(r).toEqual({ ok: true, value: { report_key: 'leads', frequency: 'weekly', day: 1, send_hour: 9, recipient_ids: [U1, U2], by_chat: true, by_email: false, enabled: true } })
  })
  it('unknown report, frequency, hour or day are refused in plain words', () => {
    expect(validateSchedule({ ...ok, report_key: 'nope' }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, frequency: 'hourly' }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, send_hour: 24 }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, day: 8 }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, frequency: 'monthly', day: 29 }, team)).toMatchObject({ ok: false })
  })
  it('daily ignores the day', () => {
    expect(validateSchedule({ ...ok, frequency: 'daily', day: 99 }, team)).toMatchObject({ ok: true, value: { day: 1 } })
  })
  it('recipients must be on this team and allowed to see the report; at least one, at most 50', () => {
    expect(validateSchedule({ ...ok, recipient_ids: ['33333333-3333-4333-8333-333333333333'] }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, report_key: 'ads', recipient_ids: [U2] }, team)).toMatchObject({ ok: false, error: expect.stringMatching(/may not see/) })
    expect(validateSchedule({ ...ok, recipient_ids: [] }, team)).toMatchObject({ ok: false })
    expect(validateSchedule({ ...ok, recipient_ids: [U1, U1] }, team)).toMatchObject({ ok: true, value: { recipient_ids: [U1] } })
  })
  it('needs a way to send', () => {
    expect(validateSchedule({ ...ok, by_chat: false, by_email: false }, team)).toMatchObject({ ok: false })
  })
})
