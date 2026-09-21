import { describe, expect, it } from 'vitest'
import { normalizeSuggestions, buildSuggestPrompt } from './suggest-categories'

const company = {
  category: 'Education & Training',
  section: 'Coaching & Test Prep',
  about: 'We prepare students for Kerala PSC examinations.',
  services: 'LGS coaching, LDC coaching, bank exam coaching',
  display_name: 'ACSTI',
}

describe('cleaning up what the model proposed', () => {
  it('keeps a well-formed suggestion', () => {
    const out = normalizeSuggestions([
      { key: 'lgs', label: 'Sub Staff (LGS)', hint: 'Last Grade Servants exam', seen: 40 },
    ])
    expect(out).toEqual([
      { key: 'lgs', label: 'Sub Staff (LGS)', hint: 'Last Grade Servants exam', seen: 40 },
    ])
  })

  it('puts the ones that actually came up at the top', () => {
    // The owner should see what matters first: a category seen ninety
    // times is a different proposition from one seen twice.
    const out = normalizeSuggestions([
      { key: 'rare', label: 'Rare', hint: '', seen: 2 },
      { key: 'common', label: 'Common', hint: '', seen: 90 },
    ])
    expect(out.map((c) => c.key)).toEqual(['common', 'rare'])
  })

  it('tidies a key into something safe to store', () => {
    const out = normalizeSuggestions([
      { key: 'Sub Staff / LGS!', label: 'Sub Staff', hint: '', seen: 1 },
    ])
    expect(out[0].key).toBe('sub_staff_lgs')
  })

  it('drops a suggestion with no label to show', () => {
    expect(normalizeSuggestions([{ key: 'lgs', label: '   ', hint: '', seen: 5 }])).toEqual([])
  })

  it('drops one the model said twice', () => {
    const out = normalizeSuggestions([
      { key: 'lgs', label: 'LGS', hint: '', seen: 5 },
      { key: 'lgs', label: 'LGS again', hint: '', seen: 3 },
    ])
    expect(out).toHaveLength(1)
  })

  it('does not re-propose what is already on the list', () => {
    const out = normalizeSuggestions(
      [
        { key: 'lgs', label: 'LGS', hint: '', seen: 50 },
        { key: 'ldc', label: 'LDC', hint: '', seen: 30 },
      ],
      [{ key: 'lgs' }],
    )
    expect(out.map((c) => c.key)).toEqual(['ldc'])
  })

  it('refuses to propose more than twenty', () => {
    // A real ceiling, not a formality: classification accuracy falls as
    // labels multiply and start to overlap, so a list of forty would be
    // worse at its job than a list of twelve.
    const many = Array.from({ length: 40 }, (_, i) => ({
      key: `c${i}`,
      label: `Category ${i}`,
      hint: '',
      seen: i,
    }))
    expect(normalizeSuggestions(many)).toHaveLength(20)
  })

  it('survives anything that is not a list of suggestions', () => {
    expect(normalizeSuggestions(null)).toEqual([])
    expect(normalizeSuggestions('categories')).toEqual([])
    expect(normalizeSuggestions([null, 42, 'x'])).toEqual([])
  })

  it('treats a missing count as zero rather than failing', () => {
    const out = normalizeSuggestions([{ key: 'lgs', label: 'LGS', hint: '' }])
    expect(out[0].seen).toBe(0)
  })
})

describe('what it reads before proposing', () => {
  it("uses the business's own description of itself", () => {
    const p = buildSuggestPrompt({ company, knowledge: [], conversations: [], existing: [] })
    expect(p).toContain('ACSTI')
    expect(p).toContain('Coaching & Test Prep')
    expect(p).toContain('LGS coaching, LDC coaching')
  })

  it('uses the departments already written on knowledge entries', () => {
    // The closest thing to an answer the business has already written
    // down, so it is quoted directly rather than inferred.
    const p = buildSuggestPrompt({
      company: null,
      knowledge: [
        { title: 'Ortho OPD timings', department: 'Ortho' },
        { title: 'Dental implant cost', department: 'Dental' },
      ],
      conversations: [],
      existing: [],
    })
    expect(p).toContain('Ortho, Dental')
  })

  it('uses what customers actually sent', () => {
    const p = buildSuggestPrompt({
      company: null,
      knowledge: [],
      conversations: [{ last_message_text: 'Is there an LGS batch in December?' }],
      existing: [],
    })
    expect(p).toContain('Is there an LGS batch in December?')
  })

  it('tells it not to repeat what is already there', () => {
    const p = buildSuggestPrompt({
      company,
      knowledge: [],
      conversations: [],
      existing: [{ key: 'lgs', label: 'Sub Staff (LGS)' }],
    })
    expect(p).toContain('do not propose these again')
    expect(p).toContain('lgs (Sub Staff (LGS))')
  })

  it('tells it to keep the list short and the boundaries clear', () => {
    const p = buildSuggestPrompt({ company, knowledge: [], conversations: [], existing: [] })
    expect(p).toContain('At most 20')
    expect(p).toContain('hint that separates it')
  })

  it('tells it not to pad the list with plausible extras', () => {
    // The failure that would make the suggestion useless: a hospital
    // being offered eleven departments it does not have.
    const p = buildSuggestPrompt({ company, knowledge: [], conversations: [], existing: [] })
    expect(p).toContain('Do not pad the list')
  })

  it('builds something usable from conversations alone', () => {
    // An account that never filled in its profile still has messages,
    // and that is enough.
    const p = buildSuggestPrompt({
      company: null,
      knowledge: [],
      conversations: [{ last_message_text: 'dental implant rate?' }],
      existing: [],
    })
    expect(p).toContain('dental implant rate?')
  })
})
