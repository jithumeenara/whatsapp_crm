/**
 * A broadcast's tag audience: "Contains" and "Does not contain".
 *
 *   Contains        any of these tags (OR) — or all of them (AND)
 *   Does not contain any of these tags — always: one is enough to leave out
 *   Both together   Contains AND does not contain
 *
 * Either side may be empty: Contains alone, Does not contain alone (everyone
 * else), or both. The count and the send use this one function, so the
 * number on screen is the number that goes. "Does not contain" includes
 * people with no tags at all (a NOT EXISTS, never NOT IN over NULLs).
 */
import type { Prisma } from '@prisma/client'

export type TagMatch = 'any' | 'all'

export interface TagAudience {
  tagIds?: string[]
  tagMatch?: TagMatch
  excludeTagIds?: string[]
}

export const MAX_TAGS = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))]
}

/**
 * Why these rules cannot be used, in plain words — or null. Checked
 * before counting or sending: a list cut short would quietly widen an
 * "all of" rule, and a junk id would quietly drop a rule.
 */
export function tagRuleError(a: TagAudience): string | null {
  for (const list of [a.tagIds, a.excludeTagIds]) {
    if (list === undefined || list === null) continue
    if (!Array.isArray(list)) return 'The tag rules are not in the right form.'
    if (list.length > MAX_TAGS) return `Choose at most ${MAX_TAGS} tags on each side.`
    if (list.some((id) => typeof id !== 'string' || !UUID.test(id))) return 'One of the chosen tags is not valid.'
  }
  return null
}

/**
 * True when every named tag belongs to this account. A tag deleted while
 * the screen was open, or another account's, would otherwise turn
 * "everyone except X" into everyone.
 */
export async function tagsBelongToAccount(
  db: { tag: { count: (args: { where: { id: { in: string[] }; account_id: string } }) => Promise<number> } },
  accountId: string,
  a: TagAudience,
): Promise<boolean> {
  const ids = [...new Set([...cleanIds(a.tagIds), ...cleanIds(a.excludeTagIds)])]
  if (ids.length === 0) return true
  return (await db.tag.count({ where: { id: { in: ids }, account_id: accountId } })) === ids.length
}

export function parseTagMatch(value: unknown): TagMatch {
  return value === 'all' ? 'all' : 'any'
}

/** True when the audience names at least one tag on either side. */
export function hasTagRules(a: TagAudience): boolean {
  return cleanIds(a.tagIds).length > 0 || cleanIds(a.excludeTagIds).length > 0
}

/** The contact filter for a tag audience — combine with the sendable rule. */
export function tagAudienceWhere(a: TagAudience): Prisma.ContactWhereInput {
  const include = cleanIds(a.tagIds)
  const exclude = cleanIds(a.excludeTagIds)
  const parts: Prisma.ContactWhereInput[] = []
  if (include.length) {
    parts.push(
      parseTagMatch(a.tagMatch) === 'all'
        ? { AND: include.map((id) => ({ tags: { some: { tag_id: id } } })) }
        : { tags: { some: { tag_id: { in: include } } } },
    )
  }
  if (exclude.length) parts.push({ tags: { none: { tag_id: { in: exclude } } } })
  return parts.length ? { AND: parts } : {}
}
