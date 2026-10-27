import { describe, expect, it } from 'vitest'
import { checkKitDraft, normaliseKitDrafts } from './template-kit'

const base = { name: 'x', category: 'Utility' as const, language: 'en' as const, samples: ['Anu'] }

describe('AI template kit drafts', () => {
  it('turns the model\'s answer into checked drafts, alerts labelled for their alert', () => {
    const drafts = normaliseKitDrafts({
      templates: [{
        purpose: 'handoff_alert',
        name: 'Customer Needs Help!',
        body: 'A customer needs a person. Name: {{1}}, number: {{2}}. They said: "{{3}}". Please reply soon.',
        variables: [{ field: 'customer_name' }, { field: 'customer_phone' }, { field: 'customer_message' }],
        why: 'So staff hear at once.',
      }],
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      name: 'customer_needs_help',
      category: 'Utility',
      variable_fields: ['customer_name', 'customer_phone', 'customer_message'],
      problems: [],
    })
    expect(drafts[0].samples).toEqual(['Anu Thomas', '+91 98765 43210', 'Is the November batch still open?'])
  })

  it('names stay unique and Meta-safe', () => {
    const drafts = normaliseKitDrafts(
      { templates: [{ purpose: 'customer_utility', name: 'fee reminder', body: 'Hello {{1}}, your fee is due this week. Thank you.' }] },
      ['fee_reminder'],
    )
    expect(drafts[0].name).toBe('fee_reminder_2')
  })

  it('says what Meta would refuse', () => {
    expect(checkKitDraft({ ...base, body: '{{1}} is waiting for you.' }).problems.join()).toMatch(/start with a variable/)
    expect(checkKitDraft({ ...base, body: 'Please call {{1}}' }).problems.join()).toMatch(/end with a variable/)
    expect(checkKitDraft({ ...base, samples: ['a', 'b'], body: 'Hi {{1}}{{2}} welcome to our clinic today.' }).problems.join()).toMatch(/side by side/)
  })

  it('warns when a Utility template reads like an offer', () => {
    expect(checkKitDraft({ ...base, body: 'Hi {{1}}, get 20% off this week only, thank you.' }).warnings.join()).toMatch(/promotion/)
  })

  it('drops what is not a template at all', () => {
    expect(normaliseKitDrafts({ templates: [{ purpose: 'hack', body: 'x' }, null, 'y', { purpose: 'customer_utility' }] })).toEqual([])
    expect(normaliseKitDrafts('nope')).toEqual([])
  })

  it('an alert whose variables are not labelled is kept, with a note', () => {
    const [d] = normaliseKitDrafts({ templates: [{ purpose: 'new_contact_alert', body: 'New contact {{1}} wrote to us just now, please check.' }] })
    expect(d.variable_fields).toBeUndefined()
    expect(d.warnings.join()).toMatch(/not labelled/)
  })
})
