/**
 * The server half of the public "Get Data" form: finding a form by its
 * link, the two signatures that keep it honest, and checking what a
 * stranger sent against what the table declares.
 *
 * ── The two signatures ──────────────────────────────────────────────
 *
 * A personal link (`?c=`) says "this is the customer the business sent
 * it to". It is an HMAC over the table and the contact with the server's
 * secret, so it cannot be made up, and it cannot be moved to another
 * table. Only it attaches a submission to a customer.
 *
 * A render ticket is stamped on the page when it is served and checked
 * when it is submitted. A person takes more than a few seconds to fill
 * in a form; a script posting straight at the endpoint has no ticket, or
 * one that is a moment old. Together with a hidden honeypot field and a
 * per-address limit this keeps the form free of junk without a CAPTCHA,
 * which would mean loading a third party's script onto the page.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { resolveFormFields, validateValues, type RegistrationField } from '@/lib/ai/registration'
import {
  formFieldOrder,
  parseFormConfig,
  WEB_FORM_DISPLAY_TYPES,
  type PublicFormField,
  type TableFormConfig,
} from './public-form'
import { getFieldConfig, type FieldConfig } from './types'

const TICKET_MIN_MS = 3_000
const TICKET_MAX_MS = 12 * 60 * 60_000

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
  if (!value) throw new Error('No signing secret is configured.')
  return value
}

function hmac(label: string, body: string): string {
  return crypto.createHmac('sha256', secret()).update(`${label}:${body}`).digest('base64url').slice(0, 32)
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const FORM_TOKEN = /^[A-Za-z0-9_-]{40,64}$/

/** The unguessable part of a form's link: 256 random bits. */
export function newFormToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function signPersonalLink(tableId: string, contactId: string): string {
  return `${contactId}.${hmac('data-form-personal/v1', `${tableId}:${contactId}`)}`
}

export function verifyPersonalLink(tableId: string, value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string' || value.length > 120) return null
  const [contactId, signature] = value.split('.')
  if (!contactId || !signature || !UUID.test(contactId)) return null
  try {
    return same(signature, hmac('data-form-personal/v1', `${tableId}:${contactId}`)) ? contactId : null
  } catch {
    return null
  }
}

export function issueRenderTicket(formToken: string, now = Date.now()): string {
  return `${now}.${hmac('data-form-ticket/v1', `${formToken}:${now}`)}`
}

export function checkRenderTicket(
  formToken: string,
  ticket: unknown,
  now = Date.now(),
): 'ok' | 'too_fast' | 'expired' | 'invalid' {
  if (typeof ticket !== 'string' || ticket.length > 80) return 'invalid'
  const [stamp, signature] = ticket.split('.')
  if (!/^\d{12,14}$/.test(stamp ?? '') || !signature) return 'invalid'
  try {
    if (!same(signature, hmac('data-form-ticket/v1', `${formToken}:${stamp}`))) return 'invalid'
  } catch {
    return 'invalid'
  }
  const age = now - Number(stamp)
  if (age < TICKET_MIN_MS) return 'too_fast'
  if (age > TICKET_MAX_MS) return 'expired'
  return 'ok'
}

export interface PublicForm {
  tableId: string
  accountId: string
  tableName: string
  businessName: string | null
  config: TableFormConfig
  fields: PublicFormField[]
  responses: number
}

/** A form by its link, or null. Everything a stranger's request is
 *  allowed to reach starts here, and nothing outside the table's own
 *  account is ever read. */
export async function loadPublicForm(token: string): Promise<PublicForm | null> {
  if (!FORM_TOKEN.test(token)) return null
  const table = await prisma.dataTable.findUnique({
    where: { form_token: token },
    select: {
      id: true,
      account_id: true,
      name: true,
      form_config: true,
      fields: {
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        select: { field_key: true, label: true, field_type: true, required: true, options: true },
      },
    },
  })
  if (!table) return null

  const config = parseFormConfig(table.form_config, table.fields.map((f) => f.field_key))
  const shown = formFieldOrder(table.fields, config)
  const resolved = await resolveFormFields(table.account_id, shown)
  const fields: PublicFormField[] = resolved.map((f, i) => {
    const extra = getFieldConfig(shown[i].options as FieldConfig | null)
    const v = extra.validation ?? {}
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)
    const words = (s: unknown, max: number) =>
      typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : undefined
    const out: PublicFormField = {
      ...f,
      placeholder: words(extra.placeholder, 120),
      // A section's own description is its help text.
      help: words(f.type === 'section_header' ? extra.content : extra.help_text, 600),
      min: num(v.min),
      max: num(v.max),
      minLength: num(v.minLength),
      maxLength: num(v.maxLength),
    }
    // A section heading is never required, whatever the column says.
    if (f.type === 'section_header') out.required = false
    // A dropdown whose options come from an empty table would refuse
    // every answer; the form offers a text box instead, which is the
    // honest fallback until the list exists.
    if ((f.type === 'select' || f.type === 'radio') && !f.options?.length) out.type = 'text'
    return out
  })

  const [company, responses] = await Promise.all([
    prisma.companyProfile
      .findUnique({ where: { account_id: table.account_id }, select: { display_name: true, legal_name: true } })
      .catch(() => null),
    prisma.dataRecord.count({ where: { table_id: table.id, account_id: table.account_id, source: 'web_form' } }),
  ])

  return {
    tableId: table.id,
    accountId: table.account_id,
    tableName: table.name,
    businessName: company?.display_name?.trim() || company?.legal_name?.trim() || null,
    config,
    fields,
    responses,
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export type FormValidation =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problems: string[] }

type Scalar = string | number | boolean | null | undefined

function isScalar(v: unknown): v is Scalar {
  return v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/**
 * The limits a table sets on a field, applied to what the assistant's
 * validator has already accepted. A field's own regex pattern is
 * deliberately not run here: it is written by an admin and would be
 * evaluated against a stranger's input, and a badly written pattern is
 * enough to stall the server on a crafted answer.
 */
function limitProblem(field: PublicFormField, value: unknown): string | null {
  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) return `"${field.label}" must be at least ${field.min}.`
    if (field.max !== undefined && value > field.max) return `"${field.label}" must be at most ${field.max}.`
    return null
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (field.minLength !== undefined && length < field.minLength) {
      return `"${field.label}" needs at least ${field.minLength} characters.`
    }
    if (field.maxLength !== undefined && length > field.maxLength) {
      return `"${field.label}" can be at most ${field.maxLength} characters.`
    }
  }
  return null
}

/**
 * Every declared field, checked; anything undeclared, refused. The
 * types the assistant also writes go through the assistant's own
 * validator, so a row typed on the web and a row taken on WhatsApp are
 * held to the same rules.
 */
export function validateFormValues(fields: PublicFormField[], raw: unknown): FormValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['Nothing was sent.'] }
  const input = raw as Record<string, unknown>
  const problems: string[] = []
  const values: Record<string, unknown> = {}
  const delegated: RegistrationField[] = []
  const delegatedRaw: Record<string, unknown> = {}

  const answerable = fields.filter((f) => !WEB_FORM_DISPLAY_TYPES.has(f.type))
  const known = new Set(answerable.map((f) => f.key))
  if (Object.keys(input).some((key) => !known.has(key))) {
    problems.push('The form sent a field it does not have. Reload the page and try again.')
  }

  for (const field of answerable) {
    const v = input[field.key]
    if (!isScalar(v)) {
      problems.push(`"${field.label}" could not be read.`)
      continue
    }
    if (field.type === 'boolean') {
      const on = v === true || v === 'true' || v === 'on' || v === 'yes'
      if (field.required && !on) problems.push(`Please tick "${field.label}".`)
      values[field.key] = on
      continue
    }
    const textValue = v === undefined || v === null ? '' : String(v).trim()
    if (!textValue) {
      if (field.required) problems.push(`"${field.label}" is required.`)
      continue
    }
    if (field.type === 'time') {
      if (TIME.test(textValue)) values[field.key] = textValue
      else problems.push(`"${field.label}" has to be a time like 09:30.`)
      continue
    }
    if (field.type === 'textarea') {
      values[field.key] = textValue.slice(0, 5_000)
      continue
    }
    const { key, label, type, required, options } = field
    delegated.push({ key, label, type: type === 'radio' ? 'select' : type, required, ...(options ? { options } : {}) })
    delegatedRaw[key] = textValue
  }

  const checked = validateValues(delegated, delegatedRaw, { requireAll: false })
  if (checked.ok) Object.assign(values, checked.values)
  else problems.push(...checked.problems)

  for (const field of answerable) {
    const problem = field.key in values ? limitProblem(field, values[field.key]) : null
    if (problem) problems.push(problem)
  }

  return problems.length ? { ok: false, problems: Array.from(new Set(problems)) } : { ok: true, values }
}
