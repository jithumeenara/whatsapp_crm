import { describe, expect, it } from 'vitest'
import { cleanMapping, resolveAlertParams, templateVariables } from './alert-fields'

const values = {
  customer_name: 'Anu',
  customer_phone: '+919876543210',
  customer_message: 'Is the batch open?',
  reason: 'asked for a person',
  chat_link: 'https://x/inbox?c=1',
}

describe('staff alert template variables', () => {
  it('no setting: the old order, cut to the template\'s own count', () => {
    expect(resolveAlertParams({ body: 'Help {{1}} {{2}} — "{{3}}"', values, kind: 'handoff' })).toEqual({
      positional: ['Anu', '+919876543210', 'Is the batch open?'],
    })
  })

  it("the business's own mapping wins", () => {
    expect(resolveAlertParams({ body: '{{1}} needs you: {{2}}', values, kind: 'handoff', mapping: ['customer_phone', 'chat_link'] })).toEqual({
      positional: ['+919876543210', 'https://x/inbox?c=1'],
    })
  })

  it("an AI-made template's own record is used when nothing was chosen", () => {
    expect(resolveAlertParams({ body: 'A {{1}} B {{2}}', values, kind: 'handoff', templateFields: ['reason', 'customer_name'] })).toEqual({
      positional: ['asked for a person', 'Anu'],
    })
  })

  it('named variables fill themselves — common words too', () => {
    expect(resolveAlertParams({ body: 'Call {{name}} on {{customer_phone}} ({{link}}) {{unknown}}', values, kind: 'handoff' })).toEqual({
      byName: { name: 'Anu', customer_phone: '+919876543210', link: 'https://x/inbox?c=1', unknown: '-' },
    })
  })

  it('a missing value is a dash, never an empty parameter Meta would refuse', () => {
    expect(resolveAlertParams({ body: '{{1}} {{2}}', values: {}, kind: 'new_contact' })).toEqual({ positional: ['-', '-'] })
  })

  it('a mapping too short for the template, or with unknown fields, is ignored', () => {
    expect(cleanMapping(['customer_name'], 3)).toBeNull()
    expect(cleanMapping(['customer_name', 'password'])).toBeNull()
    expect(cleanMapping('x')).toBeNull()
  })

  it('reads variables in first-seen order, ignoring repeats', () => {
    expect(templateVariables('{{2}} {{1}} {{2}}')).toEqual({ keys: ['2', '1'], named: false })
  })
})
