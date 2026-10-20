import { describe, expect, it } from 'vitest'
import { normalizeTagDecisions, planTagOutcomes, worthClassifying } from './auto-tag-rules'

const transcript = 'Customer: എന്റെ കാൽമുട്ടിന് വേദനയാണ്, doctor nale undo?\nCustomer: kaalmuttu vedana from 2 weeks'
const tagIds = ['t-ortho', 't-cardio']

describe("reading the model's answer", () => {
  it('keeps only listed tags, with evidence the customer really wrote', () => {
    const raw = {
      tags: [
        { tag_id: 't-ortho', confidence: 'high', evidence: 'kaalmuttu vedana', reason: 'knee pain' },
        { tag_id: 't-cardio', confidence: 'high', evidence: 'chest pain since morning', reason: 'invented' },
        { tag_id: 't-made-up', confidence: 'high', evidence: 'vedana', reason: 'not a tag' },
      ],
    }
    const out = normalizeTagDecisions(raw, tagIds, transcript)
    expect(out.map((d) => d.tagId)).toEqual(['t-ortho'])
  })

  it('evidence is matched ignoring case and spacing, in any script', () => {
    const out = normalizeTagDecisions({ tags: [{ tag_id: 't-ortho', confidence: 'medium', evidence: 'കാൽമുട്ടിന്   വേദന', reason: '' }] }, tagIds, transcript)
    expect(out).toHaveLength(1)
    expect(out[0].confidence).toBe('medium')
  })

  it('at most three, each tag once, unknown confidence dropped', () => {
    const out = normalizeTagDecisions(
      { tags: [
        { tag_id: 't-ortho', confidence: 'high', evidence: 'vedana' },
        { tag_id: 't-ortho', confidence: 'medium', evidence: 'vedana' },
        { tag_id: 't-cardio', confidence: 'sure', evidence: 'doctor' },
      ] },
      tagIds,
      transcript,
    )
    expect(out.map((d) => d.tagId)).toEqual(['t-ortho'])
  })

  it('anything malformed is nothing', () => {
    expect(normalizeTagDecisions(null, tagIds, transcript)).toEqual([])
    expect(normalizeTagDecisions({ tags: 'x' }, tagIds, transcript)).toEqual([])
  })
})

describe('add, suggest or nothing', () => {
  const modes = { 't-ortho': 'auto', 't-cardio': 'suggest' } as const
  it('high on an "auto" tag is added; high on a "suggest" tag is suggested; medium is suggested; low is dropped', () => {
    const plan = planTagOutcomes(
      [
        { tagId: 't-ortho', confidence: 'high', evidence: 'a', reason: '' },
        { tagId: 't-cardio', confidence: 'high', evidence: 'b', reason: '' },
      ],
      modes,
      0,
    )
    expect(plan).toEqual([
      { tagId: 't-ortho', outcome: 'applied' },
      { tagId: 't-cardio', outcome: 'suggested' },
    ])
    expect(planTagOutcomes([{ tagId: 't-ortho', confidence: 'medium', evidence: 'a', reason: '' }], modes, 0)).toEqual([{ tagId: 't-ortho', outcome: 'suggested' }])
    expect(planTagOutcomes([{ tagId: 't-ortho', confidence: 'low', evidence: 'a', reason: '' }], modes, 0)).toEqual([])
  })
  it('no more than 2 added by the AI in one conversation — the rest become suggestions', () => {
    const plan = planTagOutcomes([{ tagId: 't-ortho', confidence: 'high', evidence: 'a', reason: '' }], modes, 2)
    expect(plan).toEqual([{ tagId: 't-ortho', outcome: 'suggested' }])
  })
})

describe('is there anything to read yet', () => {
  it('a greeting alone is not', () => {
    expect(worthClassifying(['hi'])).toBe(false)
    expect(worthClassifying(['Hello', 'ഹായ്', 'ok'])).toBe(false)
  })
  it('a real question is, in any language', () => {
    expect(worthClassifying(['kaalmuttu vedana und'])).toBe(true)
    expect(worthClassifying(['എന്റെ കാൽമുട്ടിന് വേദനയാണ്'])).toBe(true)
  })
})
