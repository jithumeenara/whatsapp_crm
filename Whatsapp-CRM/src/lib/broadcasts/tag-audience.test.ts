import { describe, expect, it } from 'vitest'
import { hasTagRules, tagAudienceWhere, tagRuleError, tagsBelongToAccount } from './tag-audience'

/**
 * Evaluates the filter the way the database would, over a few contacts,
 * so the rules are tested as behaviour rather than as object shapes.
 */
type C = { name: string; tags: string[] }
function matches(where: unknown, c: C): boolean {
  const w = where as Record<string, unknown>
  if (Array.isArray(w.AND)) return (w.AND as unknown[]).every((p) => matches(p, c))
  const rel = w.tags as { some?: { tag_id: string | { in: string[] } }; none?: { tag_id: { in: string[] } } } | undefined
  if (!rel) return true
  if (rel.some) {
    const t = rel.some.tag_id
    return typeof t === 'string' ? c.tags.includes(t) : c.tags.some((x) => t.in.includes(x))
  }
  if (rel.none) return !c.tags.some((x) => rel.none!.tag_id.in.includes(x))
  return true
}

const people: C[] = [
  { name: 'Anu', tags: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] },
  { name: 'Biju', tags: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'] },
  { name: 'Chitra', tags: ['00000000-0000-4000-8000-000000000004'] },
  { name: 'Dev', tags: [] },
  { name: 'Ezra', tags: ['00000000-0000-4000-8000-000000000001'] },
]
const who = (a: Parameters<typeof tagAudienceWhere>[0]) => people.filter((p) => matches(tagAudienceWhere(a), p)).map((p) => p.name)

describe('broadcast tag audience', () => {
  it('Contains (any): MDP or STP', () => {
    expect(who({ tagIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004'] })).toEqual(['Anu', 'Biju', 'Chitra', 'Ezra'])
  })

  it('Contains (all): MDP and Not paid', () => {
    expect(who({ tagIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'], tagMatch: 'all' })).toEqual(['Biju'])
  })

  it('Does not contain alone: everyone without Paid — including people with no tags', () => {
    expect(who({ excludeTagIds: ['00000000-0000-4000-8000-000000000002'] })).toEqual(['Biju', 'Chitra', 'Dev', 'Ezra'])
  })

  it('Both: MDP AND not Paid — the fee reminder', () => {
    expect(who({ tagIds: ['00000000-0000-4000-8000-000000000001'], excludeTagIds: ['00000000-0000-4000-8000-000000000002'] })).toEqual(['Biju', 'Ezra'])
  })

  it('one excluded tag is enough to leave someone out', () => {
    expect(who({ tagIds: ['00000000-0000-4000-8000-000000000001'], excludeTagIds: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'] })).toEqual(['Ezra'])
  })

  it('no tags on either side is not a tag audience', () => {
    expect(hasTagRules({})).toBe(false)
    expect(hasTagRules({ tagIds: [], excludeTagIds: ['00000000-0000-4000-8000-000000000002'] })).toBe(true)
  })

  it('junk in the lists is ignored by the filter, and reported before use', () => {
    const MDP = '00000000-0000-4000-8000-000000000001'
    expect(tagAudienceWhere({ tagIds: ['', 5 as unknown as string, MDP, MDP] })).toEqual({
      AND: [{ tags: { some: { tag_id: { in: [MDP] } } } }],
    })
    expect(tagRuleError({ tagIds: ['', MDP] })).toMatch(/not valid/)
    expect(tagRuleError({ tagIds: 'x' as unknown as string[] })).toMatch(/right form/)
    expect(tagRuleError({ tagIds: Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })).toMatch(/at most 50/)
    expect(tagRuleError({ tagIds: [MDP], excludeTagIds: [] })).toBeNull()
  })

  it("a tag that is not this account's (or was deleted) is refused", async () => {
    const MDP = '00000000-0000-4000-8000-000000000001'
    const OTHER = '00000000-0000-4000-8000-000000000009'
    const db = { tag: { count: async (a: { where: { id: { in: string[] } } }) => a.where.id.in.filter((id) => id === MDP).length } }
    expect(await tagsBelongToAccount(db, 'acc', { tagIds: [MDP] })).toBe(true)
    expect(await tagsBelongToAccount(db, 'acc', { tagIds: [MDP], excludeTagIds: [OTHER] })).toBe(false)
  })
})
