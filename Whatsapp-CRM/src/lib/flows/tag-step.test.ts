import { describe, expect, it } from 'vitest'
import { resolveTagStep } from './tag-step'

/**
 * Bug (18 Oct 2026): the chatbot's "Tag Contact" step asked for a tag ID in
 * a text box. People typed the tag's NAME, which matched nothing, so no tag
 * was added and nothing said why. And a step saved without a mode (the
 * form showed "Add tag") was treated as "remove".
 */
const tags = [
  { id: '6f1c2a40-1111-4b5e-9c3d-000000000001', name: 'Interested' },
  { id: '6f1c2a40-1111-4b5e-9c3d-000000000002', name: 'Paid' },
]

describe('Tag Contact step', () => {
  it('a missing mode means add, as the form shows', () => {
    expect(resolveTagStep({ tag_id: tags[0].id }, tags)).toEqual({ action: 'add', tagId: tags[0].id, problem: null })
    expect(resolveTagStep({ mode: 'remove', tag_id: tags[1].id }, tags).action).toBe('remove')
  })

  it('accepts a tag typed by name, any case', () => {
    expect(resolveTagStep({ mode: 'add', tag_id: ' interested ' }, tags).tagId).toBe(tags[0].id)
  })

  it('says plainly when the tag does not exist', () => {
    const r = resolveTagStep({ mode: 'add', tag_id: 'VIP' }, tags)
    expect(r.tagId).toBeNull()
    expect(r.problem).toMatch(/“VIP”.*no tag/i)
    expect(resolveTagStep({ mode: 'add' }, tags).problem).toMatch(/No tag chosen/)
  })
})
