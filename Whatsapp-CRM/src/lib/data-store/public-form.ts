/**
 * "Get Data" — a table's public web form: its settings and the rules for
 * what a stranger's submission may contain. Pure and client-safe, so the
 * settings panel, the public page and the server read one definition.
 *
 * ── What the form never does ────────────────────────────────────────
 *
 * It never shows a row, only takes one. It never attaches a submission
 * to a customer on the strength of a phone number somebody typed — a
 * stranger could otherwise file a record under anybody's name, and the
 * assistant would then tell that person they were registered. A row is
 * linked to a customer only through a personal link the business sent
 * them, which is signed (see public-form-server.ts).
 */

import { DEFAULT_BRAND, parseBrand, parseRules, type FormBrand, type FormRules } from './form-logic'

export const WEB_FORM_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'number',
  'date',
  'time',
  'email',
  'phone',
  'url',
  'select',
  'radio',
  'boolean',
])

/** Shown on the form but hold no answer: a heading that splits a long
 *  form into parts, the way a paper form does. */
export const WEB_FORM_DISPLAY_TYPES: ReadonlySet<string> = new Set(['section_header'])

/** One question as the public page gets it — everything it needs to ask
 *  well, nothing about the table beyond that. */
export interface PublicFormField {
  key: string
  label: string
  type: string
  required: boolean
  options?: string[]
  placeholder?: string
  help?: string
  /** Numbers. */
  min?: number
  max?: number
  /** Text. */
  minLength?: number
  maxLength?: number
}

export interface TableFormConfig {
  enabled: boolean
  /** Heading on the form; the table's name when empty. */
  title: string | null
  /** A paragraph under the heading. */
  intro: string | null
  /** Fields shown, in order. Empty = every field a web form can hold. */
  field_keys: string[]
  /** Shown after submitting. */
  success_message: string | null
  /** ISO time after which the form says it is closed. */
  closes_at: string | null
  /** Stop taking answers after this many. */
  max_responses: number | null
  /** With a personal link: one answer per customer. */
  one_per_person: boolean
  /** When set, a tick box with this text must be ticked (consent to
   *  store their details — India's DPDP Act asks for exactly this). */
  consent_text: string | null
  /** Only people sent a personal link can answer. */
  personal_only: boolean
  /** Logo, name, tagline, colour, contact details. */
  brand: FormBrand
  /** Filter / fill / show-if, per question (lib/data-store/form-logic). */
  rules: FormRules
}

export const EMPTY_FORM_CONFIG: TableFormConfig = {
  enabled: false,
  title: null,
  intro: null,
  field_keys: [],
  success_message: null,
  closes_at: null,
  max_responses: null,
  one_per_person: false,
  consent_text: null,
  personal_only: false,
  brand: DEFAULT_BRAND,
  rules: {},
}

export const DEFAULT_CONSENT =
  'I agree that my details may be stored and used to contact me about this.'

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/\r\n/g, '\n').trim().slice(0, max)
  return t || null
}

/** Reads stored or submitted settings safely. `fieldKeys` — the table's
 *  fields in their order — drops fields the table no longer has, and
 *  gives the order rules are checked against (a rule may only look at a
 *  question that comes before it). */
export function parseFormConfig(raw: unknown, fieldKeys?: readonly string[]): TableFormConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_FORM_CONFIG }
  const r = raw as Record<string, unknown>

  const keys = Array.isArray(r.field_keys)
    ? Array.from(new Set(r.field_keys.filter((k): k is string => typeof k === 'string' && k.length <= 100)))
        .filter((k) => !fieldKeys || fieldKeys.includes(k))
        .slice(0, 100)
    : []

  let closes: string | null = null
  if (typeof r.closes_at === 'string' && r.closes_at) {
    const d = new Date(r.closes_at)
    if (!Number.isNaN(d.getTime())) closes = d.toISOString()
  }

  const max =
    typeof r.max_responses === 'number' && Number.isFinite(r.max_responses) && r.max_responses >= 1
      ? Math.min(100_000, Math.floor(r.max_responses))
      : null

  return {
    enabled: r.enabled === true,
    title: text(r.title, 120),
    intro: text(r.intro, 1000),
    field_keys: keys,
    success_message: text(r.success_message, 500),
    closes_at: closes,
    max_responses: max,
    one_per_person: r.one_per_person === true,
    consent_text: text(r.consent_text, 500),
    personal_only: r.personal_only === true,
    brand: parseBrand(r.brand),
    rules: parseRules(r.rules, keys.length ? keys : (fieldKeys ?? [])),
  }
}

/** The fields a form shows, in the order the settings give. */
export function formFieldOrder<T extends { field_key: string; field_type: string }>(
  fields: readonly T[],
  config: Pick<TableFormConfig, 'field_keys'>,
): T[] {
  const usable = fields.filter(
    (f) => WEB_FORM_FIELD_TYPES.has(f.field_type) || WEB_FORM_DISPLAY_TYPES.has(f.field_type),
  )
  if (config.field_keys.length === 0) return usable
  const byKey = new Map(usable.map((f) => [f.field_key, f]))
  return config.field_keys.map((k) => byKey.get(k)).filter((f): f is T => !!f)
}

export type FormState =
  | { open: true }
  | { open: false; reason: 'off' | 'closed' | 'full' }

export function formState(
  config: TableFormConfig,
  responses: number,
  now: Date = new Date(),
): FormState {
  if (!config.enabled) return { open: false, reason: 'off' }
  if (config.closes_at && new Date(config.closes_at).getTime() <= now.getTime()) {
    return { open: false, reason: 'closed' }
  }
  if (config.max_responses !== null && responses >= config.max_responses) {
    return { open: false, reason: 'full' }
  }
  return { open: true }
}
