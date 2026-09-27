/**
 * The public form's smart behaviour and its look — pure, so the page,
 * the server and the settings panel all run the same rules.
 *
 *  • Filter:  a dropdown whose options come from another table offers
 *             only the rows that match an earlier answer ("Month:
 *             October" → only October's programmes).
 *  • Fill:    picking a row fills other questions from it (programme →
 *             its dates and target group), optionally locked so the
 *             customer cannot change them.
 *  • Show if: a question appears only when an earlier answer is a given
 *             value.
 *  • Brand:   logo, business name, tagline, colour, contact details.
 *
 * The server repeats every rule on submit and never takes a locked value
 * from the browser: a locked field is recomputed from the table, so a
 * customer who edits the page still cannot register a date that is not
 * the programme's.
 */

// ── Look ────────────────────────────────────────────────────────────────

/** Brand colours, each dark enough for white text on a button. */
export const BRAND_COLORS = {
  green: { label: 'WhatsApp green', hex: '#128C7E' },
  emerald: { label: 'Emerald', hex: '#047857' },
  teal: { label: 'Teal', hex: '#0F766E' },
  blue: { label: 'Blue', hex: '#1D4ED8' },
  indigo: { label: 'Indigo', hex: '#4338CA' },
  violet: { label: 'Violet', hex: '#6D28D9' },
  rose: { label: 'Rose', hex: '#BE123C' },
  orange: { label: 'Orange', hex: '#C2410C' },
  slate: { label: 'Graphite', hex: '#334155' },
} as const

export type BrandColor = keyof typeof BRAND_COLORS

export interface FormBrand {
  /** An image in the account's File Manager. */
  logo_file_id: string | null
  /** Shown beside the logo; the company profile's name when empty. */
  name: string | null
  /** One line under the name — "Govt. of Kerala undertaking". */
  tagline: string | null
  color: BrandColor
  /** Phone, email, website and address from the company profile, at
   *  the foot of the form. */
  show_contact: boolean
}

export const DEFAULT_BRAND: FormBrand = {
  logo_file_id: null,
  name: null,
  tagline: null,
  color: 'green',
  show_contact: true,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[A-Za-z0-9_-]{1,100}$/

function words(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

export function parseBrand(raw: unknown): FormBrand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BRAND }
  const r = raw as Record<string, unknown>
  return {
    logo_file_id: typeof r.logo_file_id === 'string' && UUID.test(r.logo_file_id) ? r.logo_file_id : null,
    name: words(r.name, 120),
    tagline: words(r.tagline, 160),
    color: typeof r.color === 'string' && r.color in BRAND_COLORS ? (r.color as BrandColor) : 'green',
    show_contact: r.show_contact !== false,
  }
}

// ── Rules ───────────────────────────────────────────────────────────────

export interface FieldRule {
  /** Offer only the source rows whose `match_column` equals the answer
   *  to `depends_on` (an earlier question). */
  filter: { depends_on: string; match_column: string } | null
  /** Take the value from the row picked in `from_field` (a question whose
   *  options come from a table), column `column`. */
  fill: { from_field: string; column: string; locked: boolean } | null
  /** Ask only when `field` is `equals`. */
  show_if: { field: string; equals: string } | null
}

export type FormRules = Record<string, FieldRule>

const EMPTY_RULE: FieldRule = { filter: null, fill: null, show_if: null }

/**
 * Reads rules safely. `formKeys` is the questions on this form, in order:
 * a rule may only look at a question that comes before it, which also
 * makes a loop of rules impossible.
 */
export function parseRules(raw: unknown, formKeys: readonly string[]): FormRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: FormRules = {}
  const position = new Map(formKeys.map((k, i) => [k, i]))
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
    if (!position.has(key) || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const before = (other: unknown): other is string =>
      typeof other === 'string' && position.has(other) && position.get(other)! < position.get(key)!
    const rule: FieldRule = { ...EMPTY_RULE }

    const f = v.filter as Record<string, unknown> | null | undefined
    if (f && before(f.depends_on) && typeof f.match_column === 'string' && KEY.test(f.match_column)) {
      rule.filter = { depends_on: f.depends_on, match_column: f.match_column }
    }
    const fill = v.fill as Record<string, unknown> | null | undefined
    if (fill && before(fill.from_field) && typeof fill.column === 'string' && KEY.test(fill.column)) {
      rule.fill = { from_field: fill.from_field, column: fill.column, locked: fill.locked !== false }
    }
    const s = v.show_if as Record<string, unknown> | null | undefined
    if (s && before(s.field) && typeof s.equals === 'string' && s.equals.trim()) {
      rule.show_if = { field: s.field, equals: s.equals.trim().slice(0, 200) }
    }
    if (rule.filter || rule.fill || rule.show_if) out[key] = rule
  }
  return out
}

// ── Lookups: the source-table rows a form needs, and nothing more ──────

/** For each dropdown whose options come from a table: the column its
 *  options are read from, and the rows, cut down to the columns the
 *  rules use. */
export type FormLookups = Record<string, { option: string; rows: Array<Record<string, string>> }>

export function norm(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

export type Answers = Record<string, string | boolean | undefined>

/** Whether a question is asked, given the answers so far. A question
 *  whose condition looks at a hidden question is hidden too. */
export function isShown(key: string, rules: FormRules, answers: Answers, seen: Set<string> = new Set()): boolean {
  const rule = rules[key]
  if (!rule?.show_if) return true
  if (seen.has(key)) return false
  seen.add(key)
  const other = rule.show_if.field
  if (!isShown(other, rules, answers, seen)) return false
  return norm(answers[other]) === norm(rule.show_if.equals)
}

/** The source rows still in play for a dropdown, after its filter. */
export function rowsFor(key: string, rules: FormRules, lookups: FormLookups, answers: Answers) {
  const lookup = lookups[key]
  if (!lookup) return []
  const filter = rules[key]?.filter
  if (!filter) return lookup.rows
  const want = norm(answers[filter.depends_on])
  if (!want) return lookup.rows
  return lookup.rows.filter((r) => norm(r[filter.match_column]) === want)
}

/** The options a dropdown offers now — narrowed by its filter, in the
 *  source table's order, each once. Null when the options do not come
 *  from a lookup (the field's own list applies). */
export function optionsFor(key: string, rules: FormRules, lookups: FormLookups, answers: Answers): string[] | null {
  const lookup = lookups[key]
  if (!lookup || !rules[key]?.filter) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rowsFor(key, rules, lookups, answers)) {
    const v = (row[lookup.option] ?? '').trim()
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}

/** What a filled question should hold, given the answers — or null
 *  when nothing has been picked yet. */
export function fillValue(key: string, rules: FormRules, lookups: FormLookups, answers: Answers): string | null {
  const fill = rules[key]?.fill
  if (!fill) return null
  const lookup = lookups[fill.from_field]
  const picked = norm(answers[fill.from_field])
  if (!lookup || !picked) return null
  const row = rowsFor(fill.from_field, rules, lookups, answers).find((r) => norm(r[lookup.option]) === picked)
  return row ? (row[fill.column] ?? '').trim() : ''
}

/** The columns of a source table the lookups for `key` must carry. */
export function columnsNeeded(key: string, rules: FormRules, option: string): string[] {
  const cols = new Set<string>([option])
  const filter = rules[key]?.filter
  if (filter) cols.add(filter.match_column)
  for (const rule of Object.values(rules)) {
    if (rule.fill?.from_field === key) cols.add(rule.fill.column)
  }
  return Array.from(cols)
}

/** Replaces {{field_key}} in a thank-you message with the answers. */
export function pipeAnswers(message: string, answers: Answers): string {
  return message.replace(/\{\{\s*([A-Za-z0-9_-]{1,100})\s*\}\}/g, (_, key: string) => {
    const v = answers[key]
    return typeof v === 'string' ? v : v === true ? 'Yes' : ''
  })
}

// ── Linking fields automatically ────────────────────────────────────────

/** A dropdown whose options come from another table, and the columns of
 *  that table a rule may safely use (worked out on the server). */
export interface FormSource {
  /** The dropdown on this table whose options come from another table. */
  field_key: string
  table_name: string
  /** The column its options are read from. */
  option_column: string
  /** Columns a rule may use: filter on, or fill from. */
  columns: Array<{ key: string; label: string }>
}

const STOP = new Set(['of', 'the', 'a', 'an'])

function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .sort()
}

/** "From Date" and "Date from", "Target Group" and "target_group",
 *  "month" and "Month": the same words in any order and case. */
export function sameName(a: string, b: string): boolean {
  const x = nameTokens(a)
  const y = nameTokens(b)
  return x.length > 0 && x.length === y.length && x.every((w, i) => w === y[i])
}

function matchesColumn(q: { key: string; label: string }, c: { key: string; label: string }): boolean {
  return sameName(q.label, c.label) || sameName(q.key, c.key) || sameName(q.label, c.key) || sameName(q.key, c.label)
}

export interface LinkSuggestion {
  field: string
  kind: 'filter' | 'fill'
  text: string
}

/**
 * The links a table's own names already imply. For each dropdown fed by
 * another table: an EARLIER question named like one of that table's
 * columns narrows it (month → Month), and a LATER question named like a
 * column is filled from the chosen row, locked (From Date ← Date from).
 * Existing rules are kept; only gaps are filled.
 */
export function suggestRules(
  questions: ReadonlyArray<{ key: string; label: string }>,
  sources: readonly FormSource[],
  existing: FormRules,
): { rules: FormRules; added: LinkSuggestion[] } {
  const rules: FormRules = Object.fromEntries(Object.entries(existing).map(([k, r]) => [k, { ...r }]))
  const added: LinkSuggestion[] = []
  const labelOf = new Map(questions.map((q) => [q.key, q.label]))
  const position = new Map(questions.map((q, i) => [q.key, i]))

  for (const source of sources) {
    const at = position.get(source.field_key)
    if (at === undefined) continue
    const columns = source.columns.filter((c) => c.key !== source.option_column)
    const rule = (rules[source.field_key] ??= { filter: null, fill: null, show_if: null })

    if (!rule.filter) {
      for (const q of questions.slice(0, at)) {
        const col = columns.find((c) => matchesColumn(q, c))
        if (col) {
          rule.filter = { depends_on: q.key, match_column: col.key }
          added.push({
            field: source.field_key,
            kind: 'filter',
            text: `“${labelOf.get(source.field_key)}” shows only the ${source.table_name} rows whose ${col.label} matches “${q.label}”`,
          })
          break
        }
      }
    }

    for (const q of questions.slice(at + 1)) {
      const target = (rules[q.key] ??= { filter: null, fill: null, show_if: null })
      if (target.fill) continue
      const col = columns.find((c) => c.key !== rule.filter?.match_column && matchesColumn(q, c))
      if (!col) continue
      target.fill = { from_field: source.field_key, column: col.key, locked: true }
      added.push({
        field: q.key,
        kind: 'fill',
        text: `“${q.label}” fills in from the chosen “${labelOf.get(source.field_key)}” (${col.label}) and is locked`,
      })
    }
  }

  for (const [k, r] of Object.entries(rules)) {
    if (!r.filter && !r.fill && !r.show_if) delete rules[k]
  }
  return { rules, added }
}

/** A rule in one line, for lists of what is set up. */
export function describeRule(
  key: string,
  rule: FieldRule,
  labelOf: (key: string) => string,
  columnLabel: (sourceField: string, column: string) => string,
): string[] {
  const out: string[] = []
  if (rule.filter) {
    out.push(`“${labelOf(key)}” narrows by “${labelOf(rule.filter.depends_on)}” (${columnLabel(key, rule.filter.match_column)})`)
  }
  if (rule.fill) {
    out.push(
      `“${labelOf(key)}” fills from “${labelOf(rule.fill.from_field)}” (${columnLabel(rule.fill.from_field, rule.fill.column)})${rule.fill.locked ? ', locked' : ''}`,
    )
  }
  if (rule.show_if) out.push(`“${labelOf(key)}” is asked only when “${labelOf(rule.show_if.field)}” is ${rule.show_if.equals}`)
  return out
}
