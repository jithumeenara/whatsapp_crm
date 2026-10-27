import { describe, expect, it } from 'vitest'
import { fitOrder, mappingFor, resolveAlertParams } from './alert-fields'

// Security review findings on the alert template variables.
describe('alert variables — review fixes', () => {
  it('a template with more variables than the old order: the real alert fills them as the preview shows', () => {
    const body = 'A {{1}} B {{2}} C {{3}} D {{4}} E {{5}} end.'
    const order = fitOrder(['customer_name', 'customer_phone', 'customer_message', 'reason'], 5, 'handoff')
    expect(order[4]).toBe('channel')
    const p = resolveAlertParams({ body, values: { channel: 'Telegram' }, kind: 'handoff' })
    expect('positional' in p && p.positional[4]).toBe('Telegram')
  })

  it('a saved mapping applies only to the template it was made for', () => {
    const saved = { template: 'customer_needs_help', fields: ['customer_phone', 'customer_name'] }
    expect(mappingFor(saved, 'customer_needs_help')).toEqual(['customer_phone', 'customer_name'])
    expect(mappingFor(saved, 'another_template')).toBeNull()
    expect(mappingFor(['customer_phone'], 'customer_needs_help')).toBeNull()
    expect(mappingFor(saved, null)).toBeNull()
  })
})
