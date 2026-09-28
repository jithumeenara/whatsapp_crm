/**
 * Loading the tables the customer-facing assistant may search, and
 * running one search. The matching itself is in table-search.ts.
 *
 * Which tables: exactly the Data Store tables connected as knowledge for
 * customers that loadKnowledge let through — people's own submissions and
 * lists of phone numbers are already gone by then (people-tables.ts). So
 * the search can never reach further than the knowledge could, and one
 * decision governs both.
 *
 * Which columns: the ones knowledge would show — identity numbers,
 * passwords and one-time codes never (isNeverKnowledge).
 *
 * Read fresh (ten seconds at most), so a row added in the Data Store is
 * found on the next message, without "Train now".
 */

import { prisma } from '@/lib/db'
import { localDate } from '@/lib/agents/zoned-time'
import { loadKnowledge } from './knowledge-store'
import { isNeverKnowledge } from './data-store-source'
import { loadCompanyProfile } from './company-profile'
import { choicesOf, searchTable, type LoadedTable, type SearchArgs, type SearchOutcome } from './table-search'

/** Rows read per table. Enough for any calendar, price list or rota; a
 *  table beyond it says so in its results rather than silently missing
 *  rows. */
const MAX_ROWS = 2000
const TTL_MS = 10_000
const CACHE_MAX = 200
const cache = new Map<string, { at: number; value: LoadedTable[] }>()

export interface AiSearchConfig {
  ask_first: string | null
  upcoming_by: string | null
}

/** The table's search settings, keeping only columns it still has. */
export function parseAiSearch(raw: unknown, fieldKeys: readonly string[]): AiSearchConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (v: unknown) => (typeof v === 'string' && fieldKeys.includes(v) ? v : null)
  return { ask_first: pick(o.ask_first), upcoming_by: pick(o.upcoming_by) }
}

export function invalidateSearchableTables(accountId: string): void {
  cache.delete(accountId)
}

export async function loadSearchableTables(accountId: string): Promise<LoadedTable[]> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId }, select: { id: true } })
  const entries = config ? (await loadKnowledge(config.id, 'customer')).tables : []

  let value: LoadedTable[] = []
  if (entries.length > 0) {
    const tables = await prisma.dataTable.findMany({
      where: { account_id: accountId, id: { in: entries.map((e) => e.tableId) } },
      select: {
        id: true,
        name: true,
        description: true,
        ai_search: true,
        fields: { orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true } },
      },
    })
    value = await Promise.all(
      tables.map(async (t) => {
        const entry = entries.find((e) => e.tableId === t.id)!
        const fields = t.fields
          .filter((f) => !isNeverKnowledge(f) && f.field_type !== 'password' && f.field_type !== 'hidden')
          .map((f) => ({ key: f.field_key, label: f.label, type: f.field_type }))
        const rows = await prisma.dataRecord.findMany({
          where: { table_id: t.id, account_id: accountId },
          orderBy: { created_at: 'asc' },
          take: MAX_ROWS + 1,
          select: { id: true, data: true },
        })
        const settings = parseAiSearch(t.ai_search, fields.map((f) => f.key))
        return {
          tableId: t.id,
          knowledgeId: entry.knowledgeId,
          name: t.name,
          purpose: entry.purpose ?? t.description?.trim() ?? null,
          fields,
          rows: rows.slice(0, MAX_ROWS).map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, unknown> })),
          askFirst: settings.ask_first,
          upcomingBy: settings.upcoming_by,
          truncated: rows.length > MAX_ROWS,
        } satisfies LoadedTable
      }),
    )
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

/** Today in the business's own zone, as YYYY-MM-DD. */
async function businessToday(accountId: string): Promise<string> {
  const profile = await loadCompanyProfile(accountId).catch(() => null)
  const zone = profile?.timezone?.trim() || 'Asia/Kolkata'
  return localDate(zone) ?? new Date().toISOString().slice(0, 10)
}

export async function runTableSearch(args: SearchArgs, accountId: string): Promise<SearchOutcome> {
  const tables = await loadSearchableTables(accountId)
  if (tables.length === 0) return { kind: 'error', error: 'This business has no tables to search.' }
  return searchTable(tables, args, await businessToday(accountId))
}

/** Few enough different values to list as choices in the prompt. */
const PROMPT_CHOICES = 12

/**
 * The tables, described for the prompt: what each is for, its columns,
 * and the values of short columns ("Month: september, october") so the
 * assistant can ask a sensible question and pass a value that exists.
 */
export function describeTables(tables: readonly LoadedTable[]): string {
  if (tables.length === 0) return ''
  const lines = tables.map((t) => {
    const cols = t.fields.map((f) => {
      if (f.type !== 'select' && f.type !== 'text') return f.label
      const choices = choicesOf(t.rows, f)
      return choices.length > 1 && choices.length <= PROMPT_CHOICES && choices.length < t.rows.length
        ? `${f.label} (${choices.join(', ')})`
        : f.label
    })
    const ask = t.askFirst ? t.fields.find((f) => f.key === t.askFirst) : null
    return [
      `- "${t.name}"${t.purpose ? ` — ${t.purpose}` : ''}. ${t.rows.length} rows.`,
      `  Columns: ${cols.join('; ')}.`,
      ask ? `  Ask the customer which ${ask.label} they want before listing rows.` : '',
    ]
      .filter(Boolean)
      .join('\n')
  })
  return [
    'BUSINESS TABLES YOU CAN SEARCH (search_records):',
    ...lines,
    '- For anything these tables answer — which ones there are, dates, fees, who, where — call search_records and answer only from what it returns. Their rows are not in your knowledge.',
    '- Pass the customer\'s own terms as conditions: a month → match "in_month"; a date or "from next week" → "from"/"until"/"before"/"after"; a price or fee limit → "at_most"/"at_least"; a name or kind → "contains". Use upcoming_only when they ask what is upcoming, next or open.',
    `- To show the rows, write [[records]] on its own line: it is replaced with the exact lines. Never retype a name, date or amount from the results.`,
    '- If the result says "needs", ask the customer exactly that, offering the choices it lists, and list nothing yet.',
    '- If nothing matches, say so plainly and offer what "available" lists. Never offer a row the search did not return.',
  ].join('\n')
}
