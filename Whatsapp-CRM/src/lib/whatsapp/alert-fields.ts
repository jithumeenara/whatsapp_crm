/**
 * What a staff-alert template's variables carry — pure, shared by the
 * sender, the settings screens and the AI template kit.
 *
 * Order of precedence when an alert goes out as a template:
 *   1. the template uses named variables ({{customer_name}}) — each is
 *      filled by its own name (common words like "name" or "phone" too);
 *   2. the business chose what {{1}}, {{2}}… carry in settings;
 *   3. the template was written by the AI kit, which recorded it;
 *   4. otherwise the old fixed order, so nothing set up today changes.
 * Exactly as many values as the template has variables are sent — one
 * too many or too few and Meta refuses the whole message.
 */

export const ALERT_FIELDS = [
  'customer_name',
  'customer_phone',
  'customer_message',
  'reason',
  'channel',
  'chat_link',
  'time',
  'business_name',
] as const
export type AlertField = (typeof ALERT_FIELDS)[number]

export const ALERT_FIELD_LABEL: Record<AlertField, string> = {
  customer_name: 'Customer name',
  customer_phone: 'Customer number',
  customer_message: 'What they said',
  reason: 'Why the AI handed over',
  channel: 'Channel (WhatsApp, Instagram…)',
  chat_link: 'Link to the chat',
  time: 'Time',
  business_name: 'Business name',
}

/** Sample values: the test alert and the AI kit's Meta samples. */
export const ALERT_FIELD_SAMPLE: Record<AlertField, string> = {
  customer_name: 'Anu Thomas',
  customer_phone: '+91 98765 43210',
  customer_message: 'Is the November batch still open?',
  reason: 'asked for a person',
  channel: 'WhatsApp',
  chat_link: 'https://example.com/inbox?c=123',
  time: '27 Oct, 2:35 pm',
  business_name: 'Your business',
}

export type AlertKind = 'handoff' | 'new_contact'

/** Which fields each alert has, and the old fixed order. */
export const ALERT_KINDS: Record<AlertKind, { fields: AlertField[]; legacy: AlertField[] }> = {
  handoff: {
    fields: ['customer_name', 'customer_phone', 'customer_message', 'reason', 'channel', 'chat_link', 'time', 'business_name'],
    legacy: ['customer_name', 'customer_phone', 'customer_message', 'reason'],
  },
  new_contact: {
    fields: ['customer_name', 'customer_phone', 'customer_message', 'channel', 'chat_link', 'time', 'business_name'],
    legacy: ['customer_name', 'customer_phone', 'customer_message', 'channel'],
  },
}

const ALIASES: Record<string, AlertField> = {
  name: 'customer_name', customer: 'customer_name', customer_name: 'customer_name', contact_name: 'customer_name',
  phone: 'customer_phone', number: 'customer_phone', mobile: 'customer_phone', customer_phone: 'customer_phone', customer_number: 'customer_phone',
  message: 'customer_message', text: 'customer_message', customer_message: 'customer_message', query: 'customer_message',
  reason: 'reason', why: 'reason',
  channel: 'channel', source: 'channel',
  link: 'chat_link', chat_link: 'chat_link', url: 'chat_link',
  time: 'time', date: 'time', when: 'time',
  business: 'business_name', business_name: 'business_name', company: 'business_name',
}

export function isAlertField(v: unknown): v is AlertField {
  return typeof v === 'string' && (ALERT_FIELDS as readonly string[]).includes(v)
}

/** A stored mapping that is usable for `count` variables, or null. */
export function cleanMapping(raw: unknown, count?: number): AlertField[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return null
  if (!raw.every(isAlertField)) return null
  if (count !== undefined && raw.length < count) return null
  return raw as AlertField[]
}

/**
 * A starting order made to fit `count` variables: what is given, then the
 * alert's other fields in their usual order — the same on screen and in
 * the real alert, so the preview never promises what is not sent.
 */
export function fitOrder(base: readonly AlertField[], count: number, kind: AlertKind): AlertField[] {
  const out = base.slice(0, count)
  for (const f of ALERT_KINDS[kind].fields) {
    if (out.length >= count) break
    if (!out.includes(f)) out.push(f)
  }
  return out
}

/**
 * A saved mapping belongs to the template it was made for. Stored as
 * { template, fields }; for any other template it is ignored, so choosing
 * a new template never inherits slots meant for the old one.
 */
export function mappingFor(raw: unknown, templateName: string | null | undefined): AlertField[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !templateName) return null
  const r = raw as { template?: unknown; fields?: unknown }
  return r.template === templateName ? cleanMapping(r.fields) : null
}

/** {{1}}, {{2}}… or {{customer_name}}… in a template body, first-seen order. */
export function templateVariables(body: string | null | undefined): { keys: string[]; named: boolean } {
  const keys: string[] = []
  for (const m of (body ?? '').matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) if (!keys.includes(m[1])) keys.push(m[1])
  return { keys, named: keys.length > 0 && keys.some((k) => !/^\d+$/.test(k)) }
}

export type AlertParams = { positional: string[] } | { byName: Record<string, string> }

export function resolveAlertParams(args: {
  body: string | null | undefined
  values: Partial<Record<AlertField, string>>
  kind: AlertKind
  /** What the business chose in settings, for this template (mappingFor). */
  mapping?: unknown
  /** What the AI kit recorded on the template. */
  templateFields?: unknown
}): AlertParams {
  const { keys, named } = templateVariables(args.body)
  const val = (f: AlertField | undefined) => (f && args.values[f]?.trim()) || '-'
  if (named) {
    const byName: Record<string, string> = {}
    for (const k of keys) byName[k] = val(isAlertField(k) ? k : ALIASES[k.toLowerCase()])
    return { byName }
  }
  const count = keys.length
  const order = fitOrder(
    cleanMapping(args.mapping, count) ?? cleanMapping(args.templateFields, count) ?? ALERT_KINDS[args.kind].legacy,
    count,
    args.kind,
  )
  return { positional: Array.from({ length: count }, (_, i) => val(order[i])) }
}
