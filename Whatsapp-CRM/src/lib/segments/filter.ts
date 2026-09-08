import { Prisma } from '@prisma/client'

/**
 * Shared Segment filter-config → Prisma where-clause builder. Was
 * duplicated verbatim in /api/segments/[id] and /api/meta-ads/audiences —
 * both need the exact same rule semantics since a Meta Custom Audience
 * sync targets the same Segment rows the Segments UI itself previews and
 * counts. Found duplicated in the full-app audit.
 */
export type FilterRule = { field: string; op: string; value: string }
export type FilterConfig = { match?: 'all' | 'any'; rules?: FilterRule[] }

export function buildContactWhere(config: FilterConfig, accountId: string): Prisma.ContactWhereInput {
  const { match = 'all', rules = [] } = config
  const clauses: Prisma.ContactWhereInput[] = rules.map((rule) => {
    const { field, op, value } = rule
    switch (op) {
      case 'contains':
        return { [field]: { contains: value, mode: 'insensitive' } }
      case 'not_contains':
        return { NOT: { [field]: { contains: value, mode: 'insensitive' } } }
      case 'equals':
        return { [field]: { equals: value, mode: 'insensitive' } }
      case 'not_equals':
        return { NOT: { [field]: { equals: value, mode: 'insensitive' } } }
      case 'starts_with':
        return { [field]: { startsWith: value, mode: 'insensitive' } }
      case 'is_empty':
        return { OR: [{ [field]: null }, { [field]: '' }] }
      case 'is_not_empty':
        return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: '' } }] }
      default:
        return {}
    }
  })

  return {
    account_id: accountId,
    ...(clauses.length > 0 ? (match === 'all' ? { AND: clauses } : { OR: clauses }) : {}),
  }
}
