/**
 * What the Sheet routing screen (and the AI) may send for a rule — checked
 * field by field on the server. Nothing from the body is stored as it came.
 */

import { ROUTE_OPS, type RouteCondition, type RouteField, type RouteOp } from './sheet-route-rules'

export interface RuleInput {
  name: string
  enabled: boolean
  is_fallback: boolean
  match: 'all' | 'any'
  conditions: RouteCondition[]
  spreadsheet_id: string
  spreadsheet_name: string | null
  tab_title: string
  split_template: string | null
  split_into: 'tab' | 'sheet'
  columns: Array<{ field_key: string; header: string }>
  move_on_edit: boolean
}

const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** Conditions on real fields with real operators; unknown ones dropped, never guessed. */
export function cleanConditions(raw: unknown, fields: readonly RouteField[]): RouteCondition[] {
  const keys = new Set([...fields.map((f) => f.field_key), '__created'])
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 10)
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .filter((c) => keys.has(String(c.field_key ?? '')) && (ROUTE_OPS as readonly string[]).includes(String(c.op ?? '')))
    .map((c) => ({
      field_key: String(c.field_key),
      op: String(c.op) as RouteOp,
      value: str(c.value, 500),
      ...(c.op === 'date_between' ? { value2: str(c.value2, 40) } : {}),
    }))
}

export function parseRuleInput(body: unknown, fields: readonly RouteField[]): { rule: RuleInput } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = str(b.name, 120)
  if (!name) return { error: 'Give the rule a name.' }
  const spreadsheet_id = str(b.spreadsheet_id, 100)
  if (!SHEET_ID.test(spreadsheet_id)) return { error: 'Choose the Google Sheet the rows go to.' }
  const is_fallback = b.is_fallback === true
  const conditions = is_fallback ? [] : cleanConditions(b.conditions, fields)
  for (const c of conditions) {
    const needs = !['empty', 'not_empty'].includes(c.op)
    if (needs && !c.value && !(c.op === 'date_between' && c.value2)) return { error: 'A condition has no value.' }
  }
  const keys = new Set(fields.map((f) => f.field_key))
  const columns = (Array.isArray(b.columns) ? b.columns : [])
    .slice(0, 200)
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .filter((c) => keys.has(String(c.field_key ?? '')))
    .map((c) => ({ field_key: String(c.field_key), header: str(c.header, 100) || String(c.field_key) }))
  const split = str(b.split_template, 200)
  if (split && !/\{\{[^}]+\}\}/.test(split)) return { error: 'The split name needs at least one {{Field}}, e.g. {{Month}}.' }
  return {
    rule: {
      name,
      enabled: b.enabled !== false,
      is_fallback,
      match: b.match === 'any' ? 'any' : 'all',
      conditions,
      spreadsheet_id,
      spreadsheet_name: str(b.spreadsheet_name, 200) || null,
      tab_title: str(b.tab_title, 100) || 'Sheet1',
      split_template: split || null,
      split_into: b.split_into === 'sheet' ? 'sheet' : 'tab',
      columns,
      move_on_edit: b.move_on_edit !== false,
    },
  }
}

// ── A rule from plain words ─────────────────────────────────────────

export function aiRuleSystemPrompt(fields: readonly RouteField[], today: string): string {
  const list = fields.map((f) => {
    const opts = Array.isArray(f.options)
      ? (f.options as Array<{ label?: unknown; value?: unknown }>).map((o) => String(o?.label ?? o?.value ?? '')).filter(Boolean).slice(0, 30)
      : []
    return `- key "${f.field_key}", label "${f.label}", type ${f.field_type}${opts.length ? `, choices: ${opts.join(' | ')}` : ''}`
  })
  return [
    'You turn a business owner\'s sentence into ONE routing rule for their table. Reply with JSON only, no prose, no code fence.',
    'Shape: {"name": string, "match": "all"|"any", "conditions": [{"field_key": string, "op": string, "value": string, "value2"?: string}], "split_template": string|null, "tab_title": string|null}',
    `Operators: ${ROUTE_OPS.join(', ')}. in_month takes a month name ("October"), "YYYY-MM", "this_month", "last_month" or "next_month". date_between takes value (from) and value2 (to) as YYYY-MM-DD. one_of takes values separated by commas. "__created" is the date the row was added.`,
    'Use ONLY the field keys listed. For a field with choices, use the choice exactly as listed. Never invent fields or values the sentence does not say.',
    'split_template: only when the sentence asks for one tab/sheet per something, e.g. "{{Target group}}" or "{{Programme date|month}}" (labels in double braces; |month gives "Oct 2026"). Otherwise null.',
    'tab_title: the tab name the sentence asks for, else null.',
    `Today is ${today}.`,
    'Fields:',
    ...list,
  ].join('\n')
}

export interface AiRuleDraft {
  name: string
  match: 'all' | 'any'
  conditions: RouteCondition[]
  split_template: string | null
  tab_title: string | null
  /** Parts of the answer that were dropped (unknown field, bad operator). */
  dropped: number
}

/** The model's answer, checked: only real fields and operators survive. */
export function parseAiRule(raw: string, fields: readonly RouteField[]): AiRuleDraft | null {
  const text = raw.trim().replace(/^```[a-z]*\s*|\s*```$/g, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const asked = Array.isArray(obj.conditions) ? obj.conditions.length : 0
  const conditions = cleanConditions(obj.conditions, fields)
  const split = str(obj.split_template, 200)
  return {
    name: str(obj.name, 120) || 'New rule',
    match: obj.match === 'any' ? 'any' : 'all',
    conditions,
    split_template: split && /\{\{[^}]+\}\}/.test(split) ? split : null,
    tab_title: str(obj.tab_title, 100) || null,
    dropped: Math.max(0, asked - conditions.length),
  }
}
